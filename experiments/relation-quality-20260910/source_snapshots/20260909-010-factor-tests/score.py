"""Local full-reference-set scoring; labels never go to the model service."""
from collections import Counter
import json
import os
from pathlib import Path
import statistics

HERE = Path(__file__).resolve().parent
REFERENCE = HERE.parent / 'reference/reference-60.private.json'
VARIANTS = ['control', 'endpoint_ids', 'thinking_low', 'thinking_off', 'two_step', 'all_images', 'relevant_images']


def correct(gold, prediction):
    if prediction is None or prediction['status'] != gold['status']:
        return False
    if gold['status'] != 'supported':
        return prediction['type'] == 'none' and prediction['direction'] == 'none'
    if prediction['type'] != gold['type']:
        return False
    if gold['type'] == 'contrast':
        return prediction['direction'] in ['symmetric', 'A_to_B', 'B_to_A']
    return prediction['direction'] == {'A → B': 'A_to_B', 'B → A': 'B_to_A'}[gold['direction']]


def main():
    os.umask(0o077)
    gold = json.loads(REFERENCE.read_text())['cases']
    batches = {}
    for n in range(1, 5):
        job = json.loads((HERE / f'requests/control-{n:02}.json').read_text())
        for identifier in job['endpoint_pairs']:
            batches[identifier] = n
    records = {}
    for path in (HERE / 'outputs').glob('r*-*.json'):
        record = json.loads(path.read_text())
        if record['variant'] in VARIANTS:
            records[record['variant'], record['repeat'], record['batch']] = record
    rows = []
    for variant in VARIANTS:
        for repeat in [1, 2]:
            for expected in gold:
                record = records.get((variant, repeat, batches[expected['id']]))
                predictions = {r['id']: r for r in record.get('normalized_decisions', [])} if record and record['status'] == 'completed' else {}
                prediction = predictions.get(expected['id'])
                rows.append({'variant': variant, 'repeat': repeat, 'id': expected['id'],
                    'reference_id': expected['reference_id'], 'group': expected['reference_id'][0],
                    'run_status': record['status'] if record else 'not_run',
                    'correct': correct(expected, prediction), 'prediction': prediction,
                    'expected': {k: expected[k] for k in ['status', 'type', 'direction']}})
    summaries = []
    for variant in VARIANTS:
        for repeat in [1, 2, 'pooled']:
            selected = [r for r in rows if r['variant'] == variant and (repeat == 'pooled' or r['repeat'] == repeat)]
            calls = [r for (v, n, b), r in records.items() if v == variant and (repeat == 'pooled' or n == repeat)]
            complete = len(calls) == (8 if repeat == 'pooled' else 4)
            groups = {}
            for group in ['P', 'N', 'I', 'R']:
                gs = [r for r in selected if r['group'] == group]
                type_matches = [r for r in gs if r['prediction'] and r['prediction']['status'] == 'supported' and r['prediction']['type'] == r['expected']['type']]
                groups[group] = {'count': len(gs), 'answered': sum(r['prediction'] is not None for r in gs),
                    'correct': sum(r['correct'] for r in gs),
                    'type_correct': len(type_matches) if group == 'P' else None,
                    'type_correct_wrong_direction': sum(not r['correct'] for r in type_matches) if group == 'P' else None,
                    'false_supported': sum(r['prediction'] is not None and r['prediction']['status'] == 'supported' for r in gs) if group in ['N', 'I'] else None}
            elapsed = [c['elapsed_seconds'] for c in calls]
            metrics = {}
            for name, included in [('PN', ['P', 'N']), ('PNI', ['P', 'N', 'I'])]:
                numerator = sum(groups[g]['correct'] for g in included)
                denominator = sum(groups[g]['count'] for g in included)
                metrics[name] = {'correct': numerator, 'total': denominator,
                    'percent': round(numerator / denominator * 100, 2) if complete else None}
            summaries.append({'variant': variant, 'repeat': repeat, 'complete': complete,
                'calls': len(calls), 'statuses': dict(Counter(c['status'] for c in calls)), 'groups': groups, **metrics,
                'unavailable_citation_decisions': sum(r['prediction'] is not None and not r['prediction']['citation_ids_available'] for r in selected),
                'elapsed_total_seconds': round(sum(elapsed), 3),
                'elapsed_median_seconds': round(statistics.median(elapsed), 3) if elapsed else None,
                'prompt_tokens': sum((c.get('usage') or {}).get('prompt_tokens', 0) for c in calls),
                'completion_tokens': sum((c.get('usage') or {}).get('completion_tokens', 0) for c in calls)})
    comparisons = {}
    for variant in VARIANTS[1:]:
        counts = Counter()
        changed = []
        for row in rows:
            if row['variant'] != variant or row['group'] not in ['P', 'N'] or row['run_status'] == 'not_run':
                continue
            control = next(r for r in rows if r['variant'] == 'control' and r['repeat'] == row['repeat'] and r['id'] == row['id'])
            if control['run_status'] == 'not_run':
                continue
            category = 'both_correct' if row['correct'] and control['correct'] else 'both_wrong' if not row['correct'] and not control['correct'] else 'improved' if row['correct'] else 'regressed'
            counts[category] += 1
            if category in ['improved', 'regressed']:
                changed.append({'repeat': row['repeat'], 'reference_id': row['reference_id'], 'change': category})
        comparisons[variant] = {'counts': dict(counts), 'changed_cases': changed}
    facts_path = HERE / 'outputs/r1-read_facts.json'
    facts = json.loads(facts_path.read_text()) if facts_path.exists() else None
    report = {'summaries': summaries, 'vs_control': comparisons,
              'visual_fact_stage': {k: facts.get(k) for k in ['status', 'elapsed_seconds', 'usage']} if facts else None,
              'limits': ['Same60 cases repeated, not120 independent cases', 'Fixed supplied endpoints; no concept-extraction accuracy implied',
                         'Citation-ID validity is separate from source-semantic support', 'R cases are diagnostic, not unique gold',
                         'Two-step total pipeline time must additionally include the single fact-reading call']}
    (HERE / 'pair-results.private.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    (HERE / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps([s for s in summaries if s['repeat'] == 'pooled'], ensure_ascii=False))


if __name__ == '__main__':
    main()
