"""Independent reasoning-mode experiment with a free prefix and constrained final JSON."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import tarfile

HERE = Path(__file__).resolve().parent
PRIOR = HERE.parent / '20260909-010-factor-tests'


def main():
    os.umask(0o077)
    requests = HERE / 'requests'
    requests.mkdir(exist_ok=True)
    jobs = []
    for batch in range(1, 5):
        original = json.loads((PRIOR / f'requests/control-{batch:02}.json').read_text())
        prompt, data = original['body']['messages'][0]['content'].split('\nINPUT:\n', 1)
        prompt = prompt.replace('Return only {decisions:[{id,status,type,direction,evidence,reason}]} JSON.',
            'The final answer is {decisions:[{id,status,type,direction,evidence,reason}]} JSON.')
        prompt += ('\nEnclose the final JSON in <final_json> and </final_json>. '
                   'Any preparatory text must stay outside that final region. '
                   'Do not mention these delimiters in preparatory text; use them only once for the final answer. '
                   'Include a decision for every supplied pair. Do not include reasoning text inside the final JSON except the requested concise reason.\n')
        schema = original['body']['response_format']['json_schema']['schema']
        for mode in ['xhigh', 'low', 'off']:
            job = deepcopy(original)
            job['name'] = f'{mode}-{batch:02}'
            job['mode'] = mode
            body = job['body']
            body['messages'][0]['content'] = prompt + '\nINPUT:\n' + data
            body['max_tokens'] = 8192
            body['skip_special_tokens'] = False
            body['chat_template_kwargs'] = {'enable_thinking': False} if mode == 'off' else {'enable_thinking': True, 'reasoning_effort': mode}
            body['response_format'] = {'type': 'structural_tag', 'format': {
                'type': 'triggered_tags', 'triggers': ['<final_json>'],
                'tags': [{'type': 'tag', 'begin': '<final_json>',
                          'content': {'type': 'json_schema', 'json_schema': schema}, 'end': '</final_json>'}],
                'at_least_one': True, 'stop_after_first': True}}
            job['final_schema'] = schema
            target = requests / f'{job["name"]}.json'
            target.write_text(json.dumps(job, ensure_ascii=False, indent=2) + '\n')
            jobs.append({'name': job['name'], 'mode': mode, 'batch': batch,
                         'request_file_sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    manifest = {'status': 'prepared_not_executed', 'purpose': 'Fulfil the requested reasoning-budget comparison after finding that classic JSON grammar leaves no independent free reasoning phase.',
        'source': 'Same OCR and three images16/19/29 as run010 control, same60 pairs and endpoint metadata.',
        'changed_protocol_for_all_arms': 'Allow unconstrained prefix; constrain only the final tagged JSON. No Pod/service restart or configuration mutation.',
        'modes': ['xhigh', 'low', 'off'], 'seeds': [17001, 17002], 'repeats': 2,
        'planned_calls': 24, 'compatibility_probe_calls': 1, 'output_budget': 8192,
        'output_budget_note': 'Same8192 cap in all three arms, including prefix and final answer. Independent from run0104096-cap classic JSON results; do not pool scores or claim a one-variable delta against that earlier protocol.',
        'retention': 'Never save the unconstrained prefix or reasoning fields. Save only final-region JSON, byte/character counts, usage, status and latency.',
        'interpretation': 'Free prefix is permitted; measure whether it is actually emitted. Prefix character counts are not exact reasoning-token counts. Same42PN/52PNI reference scoring, R diagnostic.',
        'jobs': jobs}
    (HERE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    with tarfile.open(HERE / 'inputs.tar.gz', 'w:gz') as tar:
        for name in ['requests', 'manifest.json', 'run.py']:
            tar.add(HERE / name, arcname=name)
    print(json.dumps({'jobs': len(jobs), 'model_calls_planned': 24, 'archive_bytes': (HERE / 'inputs.tar.gz').stat().st_size}))


if __name__ == '__main__':
    main()
