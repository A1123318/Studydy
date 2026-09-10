"""Standalone remote experiment runner. Credentials stay in environment; no reasoning retained."""
import base64
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

import jsonschema

HERE = Path(__file__).resolve().parent
BASE = 'http://127.0.0.1:8000'


def save(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def call(path, body=None, timeout=30):
    headers = {'Content-Type': 'application/json', 'Authorization': 'Bearer ' + os.environ['VLLM_API_KEY']}
    request = urllib.request.Request(BASE + path,
        data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def payload(batch, condition, seed, config):
    body = json.loads((HERE / f'batch-{batch:02}.json').read_text())
    body['seed'] = seed
    text = body['messages'][0]['content']
    # Both arms use identical content-block encoding, schema and text.
    body['messages'][0]['content'] = [{'type': 'text', 'text': text}]
    if condition == 'text_image':
        for image in config['images']:
            raw = (HERE / image['path']).read_bytes()
            assert hashlib.sha256(raw).hexdigest() == image['sha256']
            body['messages'][0]['content'].extend([
                {'type': 'text', 'text': f"PDF page {image['page']}; image evidence ID {image['evidence_id']}."},
                {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(raw).decode()}}
            ])
    return body


def main():
    os.umask(0o077)
    config = json.loads((HERE / 'config.json').read_text())
    output = HERE / 'outputs'
    output.mkdir(exist_ok=True)
    models = call('/v1/models')
    assert any(m['id'] == 'Qwen/Qwen3.8-27B-FP8' and m['max_model_len'] == config['max_context'] for m in models['data'])
    save(output / 'service.json', {'models': [{'id': m['id'], 'max_model_len': m.get('max_model_len')} for m in models['data']]})
    # Check all model inputs before inference; token count includes visual tokens.
    preflight = []
    for batch in range(1, 5):
        for condition in ['text', 'text_image']:
            body = payload(batch, condition, config['seeds'][0], config)
            result = call('/tokenize', {'model': body['model'], 'messages': body['messages'],
                          'add_generation_prompt': True, 'chat_template_kwargs': body['chat_template_kwargs']}, timeout=120)
            count = result['count']
            preflight.append({'batch': batch, 'condition': condition, 'input_tokens': count,
                              'output_budget': body['max_tokens'], 'fits': count + body['max_tokens'] <= config['max_context']})
    save(output / 'preflight.json', preflight)
    if not all(x['fits'] for x in preflight):
        print('PREFLIGHT_CONTEXT_LIMIT', flush=True)
        return
    print('PREFLIGHT_OK ' + json.dumps(preflight), flush=True)
    for repeat, seed in enumerate(config['seeds'], 1):
        for batch in range(1, 5):
            order = ['text', 'text_image'] if (repeat + batch) % 2 == 0 else ['text_image', 'text']
            for condition in order:
                name = f'r{repeat}-batch{batch:02}-{condition}'
                target = output / (name + '.json')
                if target.exists():
                    raise RuntimeError('Refusing to overwrite previous result')
                body = payload(batch, condition, seed, config)
                record = {'name': name, 'repeat': repeat, 'batch': batch, 'condition': condition,
                          'seed': seed, 'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                          'request_sha256': hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()}
                save(output / 'status.json', {**record, 'status': 'running'})
                print('START ' + name, flush=True)
                started = time.monotonic()
                try:
                    response = call('/v1/chat/completions', body, timeout=config['http_timeout_seconds'])
                    choice = response['choices'][0]
                    content = choice['message'].get('content')
                    record.update({'finish_reason': choice.get('finish_reason'), 'model': response.get('model'),
                                   'usage': response.get('usage'), 'answer_content': content,
                                   'status': 'invalid'})
                    answer = json.loads(content)
                    jsonschema.validate(answer, body['response_format']['json_schema']['schema'])
                    expected = body['response_format']['json_schema']['schema']['properties']['decisions']['items']['properties']['id']['enum']
                    observed = [item['id'] for item in answer['decisions']]
                    if sorted(observed) != sorted(expected) or choice.get('finish_reason') != 'stop':
                        raise ValueError('Incomplete or duplicated decisions')
                    record.update({'status': 'completed', 'answer': answer})
                except urllib.error.HTTPError as error:
                    record.update({'status': 'http_error', 'http_status': error.code})
                except Exception as error:
                    record.update({'status': record.get('status', 'error'), 'error_type': type(error).__name__})
                record['elapsed_seconds'] = round(time.monotonic() - started, 3)
                save(target, record)
                save(output / 'status.json', {'status': 'between_calls', 'last': name})
                print('DONE ' + json.dumps({k: record.get(k) for k in ['name', 'status', 'elapsed_seconds', 'usage']}), flush=True)
                if record['status'] in ['http_error', 'error']:
                    # A transport failure is not a semantic retry; avoid overlapping an unknown in-flight request.
                    print('STOP_TRANSPORT_FAILURE', flush=True)
                    return
    save(output / 'status.json', {'status': 'finished', 'calls': 16})
    print('EXPERIMENT_FINISHED', flush=True)


if __name__ == '__main__':
    main()
