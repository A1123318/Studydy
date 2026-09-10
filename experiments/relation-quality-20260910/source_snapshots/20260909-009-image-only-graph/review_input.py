"""Build a local evidence workbook from actual graph outputs, without auto-judging semantics."""
from collections import Counter
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
ATTEMPT = HERE / 'private-attempt'


def main():
    os.umask(0o077)
    config = json.loads((HERE / 'package/config.json').read_text())
    text_sources = {row[0]: {'id': row[0], 'page': row[1], 'kind': row[2], 'text': row[3]}
        for section in config['sections'] for row in section['evidence']}
    for condition in ['text', 'image_only']:
        source = ATTEMPT / f'graph-outputs/{condition}.json'
        if not source.exists():
            continue
        result = json.loads(source.read_text())
        if result['status'] != 'completed':
            print(condition, 'has no valid complete graph; no precision fabricated')
            continue
        graph = result['answer']
        concepts = {item['k']: item for item in graph['concepts']}
        key_counts = Counter(item['k'] for item in graph['concepts'])
        valid_sources = text_sources if condition == 'text' else {
            900000 + n: {'id': 900000 + n, 'page': n, 'kind': 'page_image', 'text': None} for n in range(1, 46)}
        items = []
        for number, relation in enumerate(graph['relations'], 1):
            first = concepts.get(relation['s'])
            second = concepts.get(relation['t'])
            endpoint_ids = {ref for node in [first, second] if node for claim in node['c'] for ref in claim['s']}
            items.append({'review_id': f'R{number:03}', 'model_relation': relation,
                'source_label': first['l'] if first else None, 'target_label': second['l'] if second else None,
                'source_claims': first['c'] if first else [], 'target_claims': second['c'] if second else [],
                'cited_sources': [valid_sources.get(ref, {'id': ref, 'unavailable': True}) for ref in relation['e']],
                'checks': {'endpoints_exist': first is not None and second is not None,
                           'self_edge': relation['s'] == relation['t'],
                           'citations_available': set(relation['e']) <= valid_sources.keys(),
                           'citations_in_endpoint_claims': set(relation['e']) <= endpoint_ids},
                'semantic_verdict': 'unreviewed', 'review_reason': None})
        workbook = {'condition': condition, 'request_sha256': result['request_sha256'],
            'concepts': graph['concepts'], 'raw_relation_count': len(items),
            'duplicate_concept_keys': {k: n for k, n in key_counts.items() if n > 1}, 'relations': items}
        out = ATTEMPT / f'review-input-{condition}.json'
        out.write_text(json.dumps(workbook, ensure_ascii=False, indent=2) + '\n')
        print(condition, len(concepts), 'concepts,', len(items), 'relations ready for source review')


if __name__ == '__main__':
    main()
