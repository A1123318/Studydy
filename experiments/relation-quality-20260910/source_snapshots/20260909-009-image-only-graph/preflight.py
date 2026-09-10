"""Tokenize both full-document conditions. No chat/completions calls or automatic fallback."""
import base64
from copy import deepcopy
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request

HERE = Path(__file__).resolve().parent
BASE = 'http://127.0.0.1:8000'


def call(path, body=None):
    req = urllib.request.Request(BASE + path,
        data=json.dumps(body, ensure_ascii=False).encode() if body is not None else None,
        headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + os.environ['VLLM_API_KEY']})
    with urllib.request.urlopen(req, timeout=240) as response:
        return json.load(response)


def main():
    os.umask(0o077)
    config = json.loads((HERE / 'config.json').read_text())
    images = json.loads((HERE / 'render-manifest.json').read_text())
    model = next(m for m in call('/v1/models')['data'] if m['id'] == config['settings']['model'])
    result = {'model': model['id'], 'service_max_model_len': model['max_model_len'],
              'page_count': 45, 'render_dpi': config['render_dpi'], 'output_budget': config['output_budget'],
              'model_inference_calls': 0, 'conditions': []}
    for condition in ['text', 'image_only']:
        if condition == 'text':
            text = config['prompt'] + '\nINPUT:\n' + json.dumps({'existing_concepts': [], 'sections': config['sections']}, ensure_ascii=False, separators=(',', ':'))
            content = [{'type': 'text', 'text': text}]
            handles = [row[0] for section in config['sections'] for row in section['evidence']]
        else:
            content = [{'type': 'text', 'text': config['prompt'] + '\nAnalyze the following complete 45-page PDF. Existing catalog is empty.\n'}]
            handles = [image['evidence_id'] for image in images]
            for image in images:
                content.extend([
                    {'type': 'text', 'text': f"PDF page {image['page']}; image Evidence ID {image['evidence_id']}."},
                    {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode((HERE / image['path']).read_bytes()).decode()}}
                ])
        schema = deepcopy(config['schema'])
        schema['properties']['concepts']['items']['properties']['c']['items']['properties']['s']['items']['enum'] = handles
        body = {**config['settings'], 'messages': [{'role': 'user', 'content': content}],
                'response_format': {'type': 'json_schema', 'json_schema': {'name': 'graph', 'strict': True, 'schema': schema}}}
        (HERE / f'request-{condition}.json').write_text(json.dumps(body, ensure_ascii=False) + '\n')
        started = time.monotonic()
        row = {'condition': condition}
        try:
            tokenized = call('/tokenize', {'model': body['model'], 'messages': body['messages'],
                'add_generation_prompt': True, 'chat_template_kwargs': body['chat_template_kwargs']})
            count = tokenized['count']
            row.update({'input_tokens': count, 'required_total_tokens': count + config['output_budget'],
                        'fits': count + config['output_budget'] <= model['max_model_len']})
        except urllib.error.HTTPError as error:
            data = json.loads(error.read())
            error_body = data.get('error', data)
            row.update({'fits': False, 'http_status': error.code,
                        'error_message': error_body.get('message', '') if isinstance(error_body, dict) else str(error_body)})
        row['elapsed_seconds'] = round(time.monotonic() - started, 3)
        result['conditions'].append(row)
    result['status'] = 'ready' if all(row['fits'] for row in result['conditions']) else 'stopped_before_inference'
    (HERE / 'preflight.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
