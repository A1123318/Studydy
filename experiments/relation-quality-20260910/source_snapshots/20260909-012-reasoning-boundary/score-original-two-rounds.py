"""Score final answers only; no access to the discarded reasoning prefix."""
from collections import Counter
import json
import os
from pathlib import Path
import statistics

HERE = Path(__file__).resolve().parent
REFERENCE = HERE.parent / 'reference/reference-60.private.json'


def correct(gold, predicted):
    if predicted is None or predicted['status'] != gold['status']:
        return False
    if gold['status'] != 'supported':
        return predicted['type'] == 'none' and predicted['direction'] == 'none'
    if predicted['type'] != gold['type']:
        return False
    if gold['type'] == 'contrast':
        return predicted['direction'] in ['A_to_B', 'B_to_A', 'symmetric']
    return predicted['direction'] == {'A → B': 'A_to_B', 'B → A': 'B_to_A'}[gold['direction']]


def main():
    os.umask(0o077)
    gold = json.loads(REFERENCE.read_text())['cases']
    batch_for_id = {}
    for n in range(1, 5):
        job = json.loads((HERE / f'requests/xhigh-{n:02}.json').read_text())
        for identifier in job['endpoint_pairs']:
            batch_for_id[identifier] = n
    records = {}
    for path in (HERE / 'outputs').glob('r*-*.json'):
        record = json.loads(path.read_text())
        records[record['mode'], record['repeat'], record['batch']] = record
    rows = []
    for mode in ['xhigh', 'low', 'off']:
        for repeat in [1, 2]:
            for expected in gold:
                record = records.get((mode, repeat, batch_for_id[expected['id']]))
                predictions = {x['id']: x for x in record.get('normalized_decisions', [])} if record and record['status'] == 'completed' else {}
                predicted = predictions.get(expected['id'])
                rows.append({'mode': mode, 'repeat': repeat, 'id': expected['id'],
                    'reference_id': expected['reference_id'], 'group': expected['reference_id'][0],
                    'run_status': record['status'] if record else 'not_run',
                    'correct': correct(expected, predicted), 'prediction': predicted,
                    'expected': {k: expected[k] for k in ['status', 'type', 'direction']}})
    summaries = []
    for mode in ['xhigh', 'low', 'off']:
        for repeat in [1, 2, 'pooled']:
            selected = [x for x in rows if x['mode'] == mode and (repeat == 'pooled' or x['repeat'] == repeat)]
            calls = [r for (m, n, b), r in records.items() if m == mode and (repeat == 'pooled' or n == repeat)]
            complete = len(calls) == (8 if repeat == 'pooled' else 4)
            groups = {}
            for g in ['P', 'N', 'I', 'R']:
                subset = [r for r in selected if r['group'] == g]
                typed = [r for r in subset if r['prediction'] and r['prediction']['status'] == 'supported' and r['prediction']['type'] == r['expected']['type']]
                groups[g] = {'count': len(subset), 'answered': sum(r['prediction'] is not None for r in subset),
                    'correct': sum(r['correct'] for r in subset),
                    'type_correct': len(typed) if g == 'P' else None,
                    'type_correct_wrong_direction': sum(not r['correct'] for r in typed) if g == 'P' else None,
                    'false_supported': sum(r['prediction'] is not None and r['prediction']['status'] == 'supported' for r in subset) if g in ['N', 'I'] else None}
            scores = {}
            for label, included in [('PN', ['P', 'N']), ('PNI', ['P', 'N', 'I'])]:
                num = sum(groups[g]['correct'] for g in included)
                den = sum(groups[g]['count'] for g in included)
                scores[label] = {'correct': num, 'total': den, 'percent': round(num / den * 100, 2) if complete else None}
            elapsed = [r['elapsed_seconds'] for r in calls]
            prefix = [r.get('prefix_non_marker_characters', 0) for r in calls]
            summaries.append({'mode': mode, 'repeat': repeat, 'complete': complete,
                'calls': len(calls), 'statuses': dict(Counter(r['status'] for r in calls)), 'groups': groups, **scores,
                'elapsed_total_seconds': round(sum(elapsed), 3),
                'elapsed_median_seconds': round(statistics.median(elapsed), 3) if elapsed else None,
                'prompt_tokens': sum((r.get('usage') or {}).get('prompt_tokens', 0) for r in calls),
                'completion_tokens': sum((r.get('usage') or {}).get('completion_tokens', 0) for r in calls),
                'prefix_non_marker_characters_median': statistics.median(prefix) if prefix else None,
                'think_end_marker_before_final_calls': sum(bool(r.get('think_end_marker_before_final')) for r in calls),
                'unavailable_citation_decisions': sum(r['prediction'] is not None and not r['prediction']['citation_ids_available'] for r in selected)})
    differences = {}
    for mode in ['low', 'off']:
        counts = Counter()
        changed = []
        for row in rows:
            if row['mode'] != mode or row['group'] not in ['P', 'N'] or row['run_status'] == 'not_run':
                continue
            control = next(r for r in rows if r['mode'] == 'xhigh' and r['repeat'] == row['repeat'] and r['id'] == row['id'])
            if control['run_status'] == 'not_run':
                continue
            category = 'both_correct' if row['correct'] and control['correct'] else 'both_wrong' if not row['correct'] and not control['correct'] else 'improved' if row['correct'] else 'regressed'
            counts[category] += 1
            if category in ['improved', 'regressed']:
                changed.append({'repeat': row['repeat'], 'reference_id': row['reference_id'], 'change': category})
        differences[mode] = {'counts': dict(counts), 'changed_cases': changed}
    report = {'summaries': summaries, 'vs_xhigh': differences,
        'limits': ['Same60 cases repeated, not120 independent cases', 'Prefix characters are not exact reasoning-token counts',
                   'This8192-token structural-tag protocol is independent from run0104096-token classic JSON grammar',
                   'Only final answer regions were retained; no reasoning text is stored',
                   'These are supplied-endpoint classification scores, not end-to-end graph precision']}
    (HERE / 'pair-results.private.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    (HERE / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps([r for r in summaries if r['repeat'] == 'pooled'], ensure_ascii=False))


if __name__ == '__main__':
    main()
