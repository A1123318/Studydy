"""Run the two full-document graph conditions only after the exact preflight fits."""
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
    temp = path.with_suffix('.tmp')
    temp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temp.replace(path)


def call(path, body=None, timeout=240):
    headers = {'Content-Type': 'application/json'}
    if os.environ.get('VLLM_API_KEY'):
        headers['Authorization'] = 'Bearer ' + os.environ['VLLM_API_KEY']
    request = urllib.request.Request(BASE + path,
        data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def main():
    os.umask(0o077)
    preflight = json.loads((HERE / 'preflight.json').read_text())
    if preflight['status'] != 'ready':
        raise RuntimeError('CONTEXT_LIMIT_STOP: run the exact whole-request preflight first')
    output = HERE / 'graph-outputs'
    output.mkdir(exist_ok=True)
    model = next(m for m in call('/v1/models')['data'] if m['id'] == preflight['model'])
    assert model['max_model_len'] == preflight['service_max_model_len'], 'Service changed after preflight'
    for condition in ['text', 'image_only']:
        target = output / (condition + '.json')
        body = json.loads((HERE / f'request-{condition}.json').read_text())
        body_hash = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        if target.exists():
            previous = json.loads(target.read_text())
            assert previous['request_sha256'] == body_hash
            if previous['status'] != 'completed':
                raise RuntimeError('Previous noncompleted call requires review; no automatic retry')
            continue
        tokens = call('/tokenize', {'model': body['model'], 'messages': body['messages'],
            'add_generation_prompt': True, 'chat_template_kwargs': body['chat_template_kwargs']})['count']
        if tokens + body['max_tokens'] > model['max_model_len']:
            save(output / 'status.json', {'status': 'context_limit_stop', 'condition': condition,
                'input_tokens': tokens, 'output_budget': body['max_tokens'], 'max_context': model['max_model_len']})
            return
        record = {'condition': condition, 'request_sha256': body_hash, 'input_tokens': tokens,
                  'seed': body['seed'], 'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
        save(output / 'status.json', {'status': 'running', **record})
        print('START_WHOLE', condition, tokens, flush=True)
        started = time.monotonic()
        try:
            response = call('/v1/chat/completions', body, timeout=1800)
            choice = response['choices'][0]
            content = choice['message'].get('content')
            record.update({'model': response.get('model'), 'usage': response.get('usage'),
                           'finish_reason': choice.get('finish_reason'), 'answer_content': content, 'status': 'invalid'})
            answer = json.loads(content)
            jsonschema.validate(answer, body['response_format']['json_schema']['schema'])
            if choice.get('finish_reason') != 'stop':
                raise ValueError('Incomplete output')
            record.update({'status': 'completed', 'answer': answer,
                           'concept_count': len(answer['concepts']), 'raw_relation_count': len(answer['relations'])})
        except urllib.error.HTTPError as error:
            record.update({'status': 'http_error', 'http_status': error.code})
        except Exception as error:
            record.update({'status': record.get('status', 'error'), 'error_type': type(error).__name__})
        record['elapsed_seconds'] = round(time.monotonic() - started, 3)
        save(target, record)
        print('DONE_WHOLE', json.dumps({k: record.get(k) for k in ['condition', 'status', 'elapsed_seconds', 'usage', 'concept_count', 'raw_relation_count']}), flush=True)
        if record['status'] in ['error', 'http_error']:
            save(output / 'status.json', {'status': 'transport_stop', 'condition': condition})
            return
    save(output / 'status.json', {'status': 'finished', 'planned_calls': 2})
    print('WHOLE_EXPERIMENT_FINISHED', flush=True)


if __name__ == '__main__':
    main()
