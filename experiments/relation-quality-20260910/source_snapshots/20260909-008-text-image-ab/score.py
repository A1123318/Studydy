"""Local-only candidate-reference scoring; does not send labels to any model."""
from collections import Counter
import json
import os
from pathlib import Path
import statistics

HERE = Path(__file__).resolve().parent
REFERENCE = HERE.parent / 'reference/reference-60.private.json'


def exact(gold, prediction):
    if prediction is None or prediction['status'] != gold['status']:
        return False
    if gold['status'] != 'supported':
        return prediction['type'] == 'none' and prediction['direction'] == 'none'
    if prediction['type'] != gold['type']:
        return False
    if gold['type'] == 'contrast':
        return prediction['direction'] in {'A_to_B', 'B_to_A', 'symmetric'}
    return prediction['direction'] == {'A → B': 'A_to_B', 'B → A': 'B_to_A'}[gold['direction']]


def main():
    os.umask(0o077)
    references = json.loads(REFERENCE.read_text())['cases']
    results = {}
    files = list((HERE / 'outputs').glob('r*-batch*-*.json'))
    for file in files:
        record = json.loads(file.read_text())
        results[record['repeat'], record['batch'], record['condition']] = record
    manifest = json.loads((HERE / 'manifest.json').read_text())
    batch_by_id = {key: batch['batch'] for batch in manifest['batches'] for key in batch['case_ids']}
    images = {item['evidence_id'] for item in manifest['images']}
    rows = []
    for repeat in [1, 2]:
        for condition in ['text', 'text_image']:
            for gold in references:
                record = results.get((repeat, batch_by_id[gold['id']], condition))
                predictions = {x['id']: x for x in record.get('answer', {}).get('decisions', [])} if record else {}
                prediction = predictions.get(gold['id']) if record and record['status'] == 'completed' else None
                rows.append({'repeat': repeat, 'condition': condition, 'id': gold['id'],
                             'reference_id': gold['reference_id'], 'group': gold['reference_id'][0],
                             'run_status': record['status'] if record else 'not_run',
                             'exact': exact(gold, prediction), 'prediction': prediction,
                             'expected': {k: gold[k] for k in ['status', 'type', 'direction']},
                             'image_cited': bool(prediction and images.intersection(prediction['evidence'])),
                             'unavailable_image_cited': bool(prediction and condition == 'text' and images.intersection(prediction['evidence']))})
    summaries = []
    for condition in ['text', 'text_image']:
        for repeat in [1, 2, 'pooled']:
            selected = [r for r in rows if r['condition'] == condition and (repeat == 'pooled' or r['repeat'] == repeat)]
            records = [r for (n, b, c), r in results.items() if c == condition and (repeat == 'pooled' or n == repeat)]
            group_summary = {}
            for group in ['P', 'N', 'I', 'R']:
                group_rows = [r for r in selected if r['group'] == group]
                group_summary[group] = {'total': len(group_rows), 'answered': sum(r['prediction'] is not None for r in group_rows),
                    'exact': sum(r['exact'] for r in group_rows),
                    'supported_type_match': sum(r['prediction'] is not None and r['prediction']['status'] == 'supported' and r['prediction']['type'] == r['expected']['type'] for r in group_rows) if group == 'P' else None,
                    'type_match_wrong_direction': sum(r['prediction'] is not None and r['prediction']['status'] == 'supported' and r['prediction']['type'] == r['expected']['type'] and not r['exact'] for r in group_rows) if group == 'P' else None,
                    'false_supported': sum(r['prediction'] is not None and r['prediction']['status'] == 'supported' for r in group_rows) if group in {'N', 'I'} else None}
            main_rows = [r for r in selected if r['group'] in {'P', 'N'}]
            complete = len(records) == (8 if repeat == 'pooled' else 4)
            elapsed = [r['elapsed_seconds'] for r in records]
            summaries.append({'condition': condition, 'repeat': repeat, 'calls': len(records), 'complete': complete,
                'statuses': dict(Counter(r['status'] for r in records)), 'groups': group_summary,
                'main_exact': sum(r['exact'] for r in main_rows), 'main_total': len(main_rows),
                'main_percent': round(100 * sum(r['exact'] for r in main_rows) / len(main_rows), 2) if complete else None,
                'elapsed_total_seconds': round(sum(elapsed), 3),
                'elapsed_median_seconds': round(statistics.median(elapsed), 3) if elapsed else None,
                'prompt_tokens': sum((r.get('usage') or {}).get('prompt_tokens', 0) for r in records),
                'completion_tokens': sum((r.get('usage') or {}).get('completion_tokens', 0) for r in records),
                'unavailable_image_citations': sum(r['unavailable_image_cited'] for r in selected)})
    paired = []
    for repeat in [1, 2]:
        for gold in references:
            if gold['reference_id'][0] not in {'P', 'N'}:
                continue
            arms = {r['condition']: r for r in rows if r['repeat'] == repeat and r['id'] == gold['id']}
            if all(r['run_status'] != 'not_run' for r in arms.values()):
                paired.append({'repeat': repeat, 'reference_id': gold['reference_id'],
                               'text_exact': arms['text']['exact'], 'image_exact': arms['text_image']['exact']})
    report = {'summaries': summaries, 'paired': {
        'improved': sum(not r['text_exact'] and r['image_exact'] for r in paired),
        'regressed': sum(r['text_exact'] and not r['image_exact'] for r in paired),
        'both_correct': sum(r['text_exact'] and r['image_exact'] for r in paired),
        'both_wrong': sum(not r['text_exact'] and not r['image_exact'] for r in paired)},
        'focus': [r for r in rows if r['reference_id'] in manifest['focus_reference_ids']],
        'limitations': manifest['limits']}
    (HERE / 'pair-results.private.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
    (HERE / 'summary.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'summaries': [s for s in summaries if s['repeat'] == 'pooled'], 'paired': report['paired']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
