"""Retains final answers only; unconstrained reasoning text is never written to disk or logs."""
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
IMAGES = Path('/tmp/studydy-009-image-only-graph/images')
OUT = HERE / 'outputs'
BASE = 'http://127.0.0.1:8000'
BEGIN = '<final_json>'
END = '</final_json>'


def save(path, value):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def call(path, body=None, timeout=240):
    headers = {'Content-Type': 'application/json'}
    if os.environ.get('VLLM_API_KEY'):
        headers['Authorization'] = 'Bearer ' + os.environ['VLLM_API_KEY']
    request = urllib.request.Request(BASE + path,
        data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.load(response)


def final_only(content):
    """Return only the final region and counts; never return or persist the prefix."""
    if not isinstance(content, str):
        return None, {'final_region_present': False, 'prefix_characters': 0, 'prefix_non_marker_characters': 0, 'reasoning_text_retained': False}
    start = content.find(BEGIN)
    if start < 0:
        return None, {'final_region_present': False, 'prefix_characters': len(content),
                      'prefix_non_marker_characters': len(content.replace('<think>', '').replace('</think>', '').strip()),
                      'reasoning_text_retained': False}
    stop = content.find(END, start + len(BEGIN))
    answer = content[start + len(BEGIN):stop if stop >= 0 else len(content)]
    counts = {'final_region_present': True, 'final_region_closed': stop >= 0,
              'prefix_characters': start, 'think_end_marker_before_final': '</think>' in content[:start],
              'prefix_non_marker_characters': len(content[:start].replace('<think>', '').replace('</think>', '').strip()),
              'final_region_characters': len(answer), 'reasoning_text_retained': False}
    return answer, counts


def build(job, seed):
    body = deepcopy(job['body'])
    body['seed'] = seed
    blocks = [{'type': 'text', 'text': body['messages'][0]['content']}]
    for page in job['image_pages']:
        blocks.extend([
            {'type': 'text', 'text': f'PDF page {page}; image Evidence ID {900000 + page}.'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode((IMAGES / f'page-{page:02}.png').read_bytes()).decode()}}
        ])
    body['messages'] = [{'role': 'user', 'content': blocks}]
    return body


def tokens(body):
    return call('/tokenize', {'model': body['model'], 'messages': body['messages'],
        'add_generation_prompt': True, 'chat_template_kwargs': body['chat_template_kwargs']})['count']


def run_one(job, repeat, max_context):
    name = f'r{repeat}-{job["name"]}'
    target = OUT / f'{name}.json'
    body = build(job, [17001, 17002][repeat - 1])
    digest = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    if target.exists():
        old = json.loads(target.read_text())
        assert old['request_sha256'] == digest
        if old['status'] in ['completed', 'invalid']:
            return
        raise RuntimeError('Prior transport failure needs review; no automatic retry')
    count = tokens(body)
    if count + body['max_tokens'] > max_context:
        save(OUT / 'context-stop.json', {'job': name, 'input_tokens': count,
            'output_budget': body['max_tokens'], 'max_context': max_context})
        raise RuntimeError('CONTEXT_LIMIT_STOP')
    save(OUT / 'status.json', {'status': 'running', 'job': name})
    record = {'name': name, 'mode': job['mode'], 'batch': job['batch'], 'repeat': repeat,
              'request_sha256': digest, 'input_tokens': count, 'seed': body['seed'],
              'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    print('START', name, count, flush=True)
    started = time.monotonic()
    try:
        response = call('/v1/chat/completions', body, timeout=2400)
        choice = response['choices'][0]
        # Ignore any dedicated reasoning fields. Only final-region text is retained.
        answer_text, counts = final_only(choice['message'].get('content'))
        record.update({'finish_reason': choice.get('finish_reason'), 'usage': response.get('usage'),
                       'model': response.get('model'), 'answer_content': answer_text, **counts, 'status': 'invalid'})
        response = choice = None
        if not counts.get('final_region_closed'):
            raise ValueError('Final region missing or incomplete')
        answer = json.loads(answer_text)
        jsonschema.validate(answer, job['final_schema'])
        if record['finish_reason'] != 'stop' or sorted(x['id'] for x in answer['decisions']) != sorted(job['endpoint_pairs']):
            raise ValueError('Incomplete response')
        input_data = json.loads(job['body']['messages'][0]['content'].split('\nINPUT:\n', 1)[1])
        available = {r[0] for section in input_data['sections'] for r in section['evidence']}
        available.update(900000 + p for p in job['image_pages'])
        normalized = [{**d, 'citation_ids_available': set(d['evidence']) <= available} for d in answer['decisions']]
        record.update({'status': 'completed', 'answer': answer, 'normalized_decisions': normalized})
    except urllib.error.HTTPError as error:
        record.update({'status': 'http_error', 'http_status': error.code, 'reasoning_text_retained': False})
    except Exception as error:
        record.update({'status': record.get('status', 'error'), 'error_type': type(error).__name__, 'reasoning_text_retained': False})
    record['elapsed_seconds'] = round(time.monotonic() - started, 3)
    save(target, record)
    print('DONE', json.dumps({k: record.get(k) for k in ['name', 'status', 'elapsed_seconds', 'usage', 'prefix_non_marker_characters', 'think_end_marker_before_final']}), flush=True)
    if record['status'] in ['http_error', 'error']:
        raise RuntimeError('TRANSPORT_STOP')


def main():
    os.umask(0o077)
    OUT.mkdir(exist_ok=True)
    model = next(x for x in call('/v1/models')['data'] if x['id'] == 'Qwen/Qwen3.8-27B-FP8')
    max_context = model['max_model_len']
    save(OUT / 'service.json', {'model': model['id'], 'max_model_len': max_context})
    jobs = {p.stem: json.loads(p.read_text()) for p in (HERE / 'requests').glob('*.json')}
    # A tiny public, non-material probe verifies the installed structural-tag decoder.
    probe_path = OUT / 'compatibility-probe.json'
    if not probe_path.exists():
        schema = {'type': 'object', 'additionalProperties': False, 'properties': {'value': {'type': 'integer', 'enum': [7]}}, 'required': ['value']}
        body = {'model': model['id'], 'messages': [{'role': 'user', 'content': 'Return <final_json>{"value":7}</final_json> and nothing else.'}],
                'temperature': 0, 'max_tokens': 64, 'chat_template_kwargs': {'enable_thinking': False},
                'response_format': {'type': 'structural_tag', 'format': {'type': 'triggered_tags', 'triggers': [BEGIN],
                    'tags': [{'type': 'tag', 'begin': BEGIN, 'content': {'type': 'json_schema', 'json_schema': schema}, 'end': END}],
                    'at_least_one': True, 'stop_after_first': True}}}
        response = call('/v1/chat/completions', body, timeout=120)
        answer_text, counts = final_only(response['choices'][0]['message'].get('content'))
        passed = counts.get('final_region_closed') and json.loads(answer_text) == {'value': 7}
        save(probe_path, {'passed': bool(passed), 'counts': counts, 'usage': response.get('usage')})
        response = None
        if not passed:
            raise RuntimeError('STRUCTURAL_TAG_PROBE_FAILED')
    preflight = []
    for name, job in jobs.items():
        body = build(job, 17001)
        count = tokens(body)
        preflight.append({'job': name, 'input_tokens': count, 'output_budget': body['max_tokens'], 'fits': count + body['max_tokens'] <= max_context})
    save(OUT / 'preflight.json', preflight)
    if not all(x['fits'] for x in preflight):
        raise RuntimeError('CONTEXT_LIMIT_STOP')
    modes = ['xhigh', 'low', 'off']
    for repeat in [1, 2]:
        for batch in range(1, 5):
            shift = (batch - 1) % 3
            order = modes[shift:] + modes[:shift]
            if repeat == 2:
                order.reverse()
            for mode in order:
                run_one(jobs[f'{mode}-{batch:02}'], repeat, max_context)
    save(OUT / 'status.json', {'status': 'finished', 'planned_calls': 24})
    print('FREE_REASONING_EXPERIMENT_FINISHED', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if OUT.exists():
            save(OUT / 'status.json', {'status': 'stopped', 'error_type': type(error).__name__})
        raise
