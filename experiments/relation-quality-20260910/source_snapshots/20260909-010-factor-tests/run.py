"""Sequential isolated factor experiment. Does not modify the model service or product."""
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
IMAGES = Path(os.environ.get('RELATION_TEST_IMAGE_ROOT', '/tmp/studydy-009-image-only-graph'))
OUTPUT = HERE / 'outputs'
BASE = 'http://127.0.0.1:8000'


def save(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    temporary.replace(path)


def call(path, body=None, timeout=240):
    headers = {'Content-Type': 'application/json'}
    if os.environ.get('VLLM_API_KEY'):
        headers['Authorization'] = 'Bearer ' + os.environ['VLLM_API_KEY']
    req = urllib.request.Request(BASE + path,
        data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return json.load(response)


def payload(job, repeat, facts=None):
    body = deepcopy(job['body'])
    body['seed'] = [17001, 17002][repeat - 1] if job['name'] != 'read_facts' else 27001
    text = body['messages'][0]['content']
    if job.get('fact_pages'):
        assert facts is not None
        prompt, data = text.split('\nINPUT:\n', 1)
        parsed = json.loads(data)
        parsed['sections'].append({'title': 'Source-derived visual observations', 'evidence': [
            [950000 + item['page'], item['page'], 'qwen_visual_fact', '\n'.join(item['facts'])]
            for item in facts['pages']]})
        text = prompt + '\nINPUT:\n' + json.dumps(parsed, ensure_ascii=False, separators=(',', ':'))
    content = [{'type': 'text', 'text': text}]
    for page in job['image_pages']:
        image = (IMAGES / 'images' / f'page-{page:02}.png').read_bytes()
        content.extend([
            {'type': 'text', 'text': f'PDF page {page}; image Evidence ID {900000 + page}.'},
            {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(image).decode()}}
        ])
    body['messages'] = [{'role': 'user', 'content': content}]
    return body


def token_count(body):
    return call('/tokenize', {'model': body['model'], 'messages': body['messages'],
        'add_generation_prompt': True, 'chat_template_kwargs': body['chat_template_kwargs']})['count']


def execute(job, repeat, max_context, facts=None):
    name = f"r{repeat}-{job['name']}"
    target = OUTPUT / f'{name}.json'
    body = payload(job, repeat, facts)
    body_hash = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
    if target.exists():
        record = json.loads(target.read_text())
        assert record['request_sha256'] == body_hash, 'Resume request mismatch'
        if record['status'] == 'invalid':
            return None  # Preserve the failed answer without retrying; independent jobs can continue.
        if record['status'] != 'completed':
            raise RuntimeError('Previous noncompleted call requires review; no automatic retry')
        return record['answer']
    count = token_count(body)
    if count + body['max_tokens'] > max_context:
        save(OUTPUT / 'context-stop.json', {'job': name, 'input_tokens': count,
            'output_budget': body['max_tokens'], 'max_context': max_context})
        raise RuntimeError('CONTEXT_LIMIT_STOP')
    save(OUTPUT / 'status.json', {'status': 'running', 'job': name})
    print('START', name, 'input_tokens', count, flush=True)
    record = {'name': name, 'variant': job.get('variant', 'read_facts'), 'batch': job.get('batch'),
        'repeat': repeat, 'request_sha256': body_hash, 'image_pages': job['image_pages'],
        'input_tokens': count, 'seed': body['seed'], 'started_at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
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
            raise ValueError('Unfinished output')
        if job['name'] == 'read_facts':
            assert sorted(x['page'] for x in answer['pages']) == [16, 19, 29]
        else:
            assert sorted(x['id'] for x in answer['decisions']) == sorted(job['endpoint_pairs'])
            # Endpoint mismatch remains an incorrect individual decision, not repaired from its reason.
            normalized = []
            original_text = job['body']['messages'][0]['content'].split('\nINPUT:\n', 1)[1]
            rows = json.loads(original_text)['sections']
            available = {row[0] for section in rows for row in section['evidence']}
            available.update(900000 + p for p in job['image_pages'])
            available.update(950000 + p for p in job.get('fact_pages', []))
            for decision in answer['decisions']:
                item = deepcopy(decision)
                if job['variant'] == 'endpoint_ids':
                    a, b = job['endpoint_pairs'][item['id']]
                    source, target_id = item.pop('source_id'), item.pop('target_id')
                    item['direction'] = ('none' if source is None and target_id is None else
                        'A_to_B' if (source, target_id) == (a, b) else
                        'B_to_A' if (source, target_id) == (b, a) else 'invalid_endpoint_ids')
                item['citation_ids_available'] = set(item['evidence']) <= available
                normalized.append(item)
            record['normalized_decisions'] = normalized
        record.update({'status': 'completed', 'answer': answer})
    except urllib.error.HTTPError as error:
        record.update({'status': 'http_error', 'http_status': error.code})
    except Exception as error:
        record.update({'status': record.get('status', 'error'), 'error_type': type(error).__name__})
    record['elapsed_seconds'] = round(time.monotonic() - started, 3)
    save(OUTPUT / f'{name}.json', record)
    print('DONE', json.dumps({k: record.get(k) for k in ['name', 'status', 'elapsed_seconds', 'usage']}), flush=True)
    if record['status'] in ['http_error', 'error']:
        raise RuntimeError('CALL_FAILED_STOP')
    return record.get('answer')


def main():
    os.umask(0o077)
    OUTPUT.mkdir(exist_ok=True)
    config = json.loads((HERE / 'prepared-inputs.json').read_text())
    model = next(m for m in call('/v1/models')['data'] if m['id'] == 'Qwen/Qwen3.8-27B-FP8')
    max_context = model['max_model_len']
    save(OUTPUT / 'service.json', {'model': model['id'], 'max_model_len': max_context})
    jobs = {x['name']: json.loads((HERE / 'requests' / (x['name'] + '.json')).read_text()) for x in config['jobs']}
    preflight = []
    for job in jobs.values():
        if job['variant'] == 'two_step':
            continue  # The exact request is checked after its one frozen fact-generation call.
        body = payload(job, 1)
        count = token_count(body)
        preflight.append({'job': job['name'], 'input_tokens': count, 'output_budget': body['max_tokens'],
                          'fits': count + body['max_tokens'] <= max_context})
        print('PREFLIGHT', job['name'], count, flush=True)
    save(OUTPUT / 'preflight.json', preflight)
    if not all(x['fits'] for x in preflight):
        save(OUTPUT / 'status.json', {'status': 'context_limit_stop'})
        print('CONTEXT_LIMIT_STOP', flush=True)
        return
    # Primary priorities: matched direction interface, then thinking controls.
    for first, second in [('control', 'endpoint_ids'), ('thinking_low', 'thinking_off')]:
        for repeat in [1, 2]:
            for batch in range(1, 5):
                order = [first, second] if (repeat + batch) % 2 == 0 else [second, first]
                for variant in order:
                    execute(jobs[f'{variant}-{batch:02}'], repeat, max_context)
    fact_job = json.loads((HERE / 'requests/read_facts.json').read_text())
    facts = execute(fact_job, 1, max_context)
    if facts is None:
        save(OUTPUT / 'two-step-dependency-failure.json', {'status': 'fact_reading_invalid', 'pair_calls_skipped': 8})
    else:
        for repeat in [1, 2]:
            for batch in range(1, 5):
                execute(jobs[f'two_step-{batch:02}'], repeat, max_context, facts)
    for repeat in [1, 2]:
        for batch in range(1, 5):
            order = ['all_images', 'relevant_images'] if (repeat + batch) % 2 == 0 else ['relevant_images', 'all_images']
            for variant in order:
                execute(jobs[f'{variant}-{batch:02}'], repeat, max_context)
    save(OUTPUT / 'status.json', {'status': 'finished', 'planned_calls': 57,
        'actual_calls': len(list(OUTPUT.glob('r*-*.json'))), 'two_step_fact_stage_valid': facts is not None})
    print('FACTOR_EXPERIMENT_FINISHED', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        if OUTPUT.exists():
            save(OUTPUT / 'status.json', {'status': 'stopped', 'error_type': type(error).__name__,
                'reason': str(error) if isinstance(error, RuntimeError) else 'Inspect progress log and the last saved result'})
        raise
