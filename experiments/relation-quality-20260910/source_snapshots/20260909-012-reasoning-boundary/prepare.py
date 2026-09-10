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
                   'When thinking is enabled, finish that region with </think> before opening the final JSON region. '
                   'When thinking is disabled, start the final JSON region directly. '
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
            final_tag = {'type': 'tag', 'begin': '<final_json>',
                         'content': {'type': 'json_schema', 'json_schema': schema}, 'end': '</final_json>'}
            output_format = final_tag if mode == 'off' else {'type': 'sequence', 'elements': [
                {'type': 'tag', 'begin': '', 'content': {'type': 'any_text', 'excludes': ['<final_json>']}, 'end': '</think>'},
                {'type': 'regex', 'pattern': '[ \\t\\r\\n]*'}, final_tag]}
            body['response_format'] = {'type': 'structural_tag', 'format': output_format}
            job['final_schema'] = schema
            target = requests / f'{job["name"]}.json'
            target.write_text(json.dumps(job, ensure_ascii=False, indent=2) + '\n')
            jobs.append({'name': job['name'], 'mode': mode, 'batch': batch,
                         'request_file_sha256': hashlib.sha256(target.read_bytes()).hexdigest()})
    manifest = {'status': 'prepared_not_executed', 'purpose': 'Fulfil the requested reasoning-budget comparison after finding that classic JSON grammar leaves no independent free reasoning phase.',
        'source': 'Same OCR and three images16/19/29 as run010 control, same60 pairs and endpoint metadata.',
        'changed_protocol_for_all_arms': 'Match actual template state: enabled modes allow a free prefix but must close </think> before final tagged JSON; disabled mode goes directly to final JSON. Same final schema. No Pod/service restart or configuration mutation.',
        'modes': ['xhigh', 'low', 'off'], 'seeds': [17001, 17002], 'repeats': 2,
        'planned_calls': 24, 'compatibility_probe_calls': 2, 'output_budget': 8192,
        'output_budget_note': 'Same8192 cap in all three arms, including prefix and final answer. Independent from run0104096-cap classic JSON results; do not pool scores or claim a one-variable delta against that earlier protocol.',
        'retention': 'Never save the unconstrained prefix or reasoning fields. Save only final-region JSON, byte/character counts, usage, status and latency.',
        'qualification': 'Offline grammar accepts a free prefix and an empty prefix ending with </think>, and rejects premature <final_json>. Enabled live outputs require the closing marker. No minimum thinking length is imposed; an empty correctly closed region is a valid observation, not a reason to retry.',
        'supersedes': '011 was a protocol pilot: its triggered tag did not require closing the already-open thinking region. Pilot scores are not used for this comparison; no semantic accuracy was examined to select this fix.',
        'interpretation': 'Free prefix is permitted; measure whether it is actually emitted. Prefix character counts are not exact reasoning-token counts. Same42PN/52PNI reference scoring, R diagnostic.',
        'jobs': jobs}
    (HERE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    with tarfile.open(HERE / 'inputs.tar.gz', 'w:gz') as tar:
        for name in ['requests', 'manifest.json', 'run.py']:
            tar.add(HERE / name, arcname=name)
    print(json.dumps({'jobs': len(jobs), 'model_calls_planned': 24, 'archive_bytes': (HERE / 'inputs.tar.gz').stat().st_size}))


if __name__ == '__main__':
    main()
