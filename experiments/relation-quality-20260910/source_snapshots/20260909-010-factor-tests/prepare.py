"""Prepare controlled whole-reference-set factor comparisons; no model calls."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
BASELINE = HERE.parent / '20260909-008-text-image-ab'


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    os.umask(0o077)
    requests = HERE / 'requests'
    requests.mkdir(exist_ok=True)
    source = [json.loads((BASELINE / f'package/batch-{n:02}.json').read_text()) for n in range(1, 5)]
    parsed = [json.loads(body['messages'][0]['content'].split('\nINPUT:\n', 1)[1]) for body in source]
    labels = list(dict.fromkeys(pair[side] for batch in parsed for pair in batch['pairs'] for side in ['a', 'b']))
    ids = {label: f'C{n:03}' for n, label in enumerate(labels, 1)}
    dump(HERE / 'endpoint-catalog.json', [{'id': key, 'label': label} for label, key in ids.items()])
    variants = ['control', 'endpoint_ids', 'thinking_low', 'thinking_off', 'two_step', 'all_images', 'relevant_images']
    jobs = []
    for n, original in enumerate(source, 1):
        instruction = original['messages'][0]['content'].split('\nINPUT:\n', 1)[0]
        instruction = instruction.replace(
            'Without an attached image, do not cite its ID or assume its content.',
            'Cite an ID only when its corresponding text evidence, source-derived visual facts, or page image is actually supplied.')
        instruction += '\nEndpoint a_id identifies a (A); b_id identifies b (B). These stable IDs are names only, not relation hints.\n'
        batch = deepcopy(parsed[n - 1])
        for pair in batch['pairs']:
            pair['a_id'], pair['b_id'] = ids[pair['a']], ids[pair['b']]
        relevant = sorted({int(p) for pair in batch['pairs'] for p in re.findall(r'\d+', pair['pages'])})
        assert all(1 <= p <= 45 for p in relevant)
        for variant in variants:
            body = deepcopy(original)
            prompt = instruction
            schema = body['response_format']['json_schema']['schema']
            props = schema['properties']['decisions']['items']['properties']
            text_handles = [row[0] for section in batch['sections'] for row in section['evidence']]
            # Identical citation grammar across all arms; actual availability is checked separately.
            props['evidence']['items']['enum'] = sorted(set(text_handles + list(range(900001, 900046)) + [950016, 950019, 950029]))
            if variant == 'endpoint_ids':
                del props['direction']
                props['source_id'] = {'type': ['string', 'null'], 'enum': [None, *ids.values()]}
                props['target_id'] = {'type': ['string', 'null'], 'enum': [None, *ids.values()]}
                required = schema['properties']['decisions']['items']['required']
                required.remove('direction')
                required.extend(['source_id', 'target_id'])
                prompt = prompt.replace('type=none,direction=none', 'type=none,source_id=null,target_id=null')
                prompt = prompt.replace('{id,status,type,direction,evidence,reason}', '{id,status,type,source_id,target_id,evidence,reason}')
                prompt += ('For supported relations, return the actual source_id and target_id from this pair in the '
                           'type-defined source-to-target order. Both must identify this pair\'s two endpoints. '
                           'For contrast either order is valid. Non-supported decisions must have both IDs null.\n')
            if variant == 'thinking_low':
                body['chat_template_kwargs'] = {'enable_thinking': True, 'reasoning_effort': 'low'}
            elif variant == 'thinking_off':
                body['chat_template_kwargs'] = {'enable_thinking': False}
            body['messages'] = [{'role': 'user', 'content': prompt + '\nINPUT:\n' + json.dumps(batch, ensure_ascii=False, separators=(',', ':'))}]
            pages = list(range(1, 46)) if variant == 'all_images' else relevant if variant == 'relevant_images' else [] if variant == 'two_step' else [16, 19, 29]
            job = {'name': f'{variant}-{n:02}', 'variant': variant, 'batch': n, 'image_pages': pages,
                   'body': body, 'fact_pages': [16, 19, 29] if variant == 'two_step' else [],
                   'endpoint_pairs': {pair['id']: [pair['a_id'], pair['b_id']] for pair in batch['pairs']}}
            file = requests / f'{variant}-{n:02}.json'
            dump(file, job)
            jobs.append({'name': job['name'], 'variant': variant, 'batch': n,
                         'image_pages': pages, 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
    fact_schema = {'type': 'object', 'additionalProperties': False, 'required': ['pages'], 'properties': {
        'pages': {'type': 'array', 'minItems': 3, 'maxItems': 3, 'items': {'type': 'object', 'additionalProperties': False,
            'required': ['page', 'facts'], 'properties': {'page': {'type': 'integer', 'enum': [16, 19, 29]},
            'facts': {'type': 'array', 'items': {'type': 'string', 'minLength': 1}}}}}}}
    fact_body = {key: deepcopy(source[0][key]) for key in ['model', 'temperature', 'top_p', 'top_k', 'min_p',
                 'presence_penalty', 'repetition_penalty', 'chat_template_kwargs', 'max_tokens']}
    fact_body.update({'seed': 27001, 'messages': [{'role': 'user', 'content':
        'Read the three supplied PDF page images and record only facts directly visible on each page. '
        'Preserve names, array dimensions, table rows/columns, numbers, code literals and arrow endpoints/order. '
        'Use concise Traditional Chinese statements. Describe visible composition or process steps without inventing '
        'hidden facts. Do not create a knowledge graph, classify prerequisite/application/example relations, or infer '
        'learning order. If something cannot be read, state that it is unreadable instead of guessing. '
        'Return {pages:[{page,facts:[...]}]} JSON, one entry for each supplied page. No expected answers are supplied.'}],
        'response_format': {'type': 'json_schema', 'json_schema': {'name': 'visible_facts', 'strict': True, 'schema': fact_schema}}})
    dump(requests / 'read_facts.json', {'name': 'read_facts', 'image_pages': [16, 19, 29], 'body': fact_body})
    dump(HERE / 'prepared-inputs.json', {'status': 'prepared_not_executed', 'jobs': jobs,
        'endpoint_count': len(ids), 'cases_per_arm': 60, 'repeats': 2, 'seeds': [17001, 17002],
        'image_source': '../20260909-009-image-only-graph/source.pdf, rendered144dpi without resizing',
        'control_note': 'Fresh shared control includes the same endpoint-ID metadata and citation grammar as the variants; do not substitute run008 results for this control.',
        'schema_only_difference': 'endpoint_ids changes output fields and their instructions; evidence and endpoint labels remain identical',
        'fact_policy': 'Freeze the single visible-facts response if valid, without hand correction; an invalid response stops this arm. Supply as text units950016/950019/950029 for both repeated two-step classifications.',
        'context_policy': 'Preflight each whole request; stop on insufficient context. No automatic re-batching, downsampling or truncation.'})
    print(json.dumps({'prepared_jobs': len(jobs), 'fact_jobs': 1, 'concept_endpoints': len(ids), 'model_calls': 0}))


if __name__ == '__main__':
    main()
