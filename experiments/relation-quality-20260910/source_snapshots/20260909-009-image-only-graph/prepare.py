"""Prepare a whole-document image-only graph experiment; no OCR/product edits."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import tarfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PRIOR = ROOT / '.studydy-evaluation/relation/runs/20260909-007-qwen-validation'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def save(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def main():
    os.umask(0o077)
    package = HERE / 'package'
    package.mkdir(exist_ok=True)
    source = Path(os.environ['RELATION_TEST_SOURCE_PDF'])
    assert sha(source) == '07b1c1c1352934f75cc5182aa15db8a702138861f7557f470f9200ac33b06d13'
    (package / 'source.pdf').write_bytes(source.read_bytes())
    extraction = json.loads((PRIOR / 'requests/extract-baseline-current.json').read_text())
    original_prompt = extraction['messages'][0]['content'].split('\nINPUT:\n', 1)[0]
    prompt = original_prompt.replace(
        'Evidence rows: [id,page,kind,exact_text].',
        'Sources are text Evidence rows [id,page,kind,exact_text], or labelled full-page PDF images. '
        'Image labels give the PDF page and integer Evidence ID. Use only the supplied source modality; '
        'images may supply facts, code, table structure and diagram relationships, but do not infer unseen content. '
        'A diagram arrow alone does not establish a learning prerequisite.')
    prompt = prompt.replace('New Claims cite only current section rows.', 'Claims cite only supplied text or image Evidence IDs.')
    prompt = prompt.replace('Claim: {m:meaning or null,s:[evidence ids]}.', 'Claim: {m:concise grounded meaning,s:[evidence ids]}.')
    prompt = prompt.replace('Use m=null for complete code/formulas or already concise source statements.',
                            'Always set m to a concise, complete source-supported statement; do not use null.')
    assert prompt != original_prompt and 'Use m=null' not in prompt
    # The same current OCR evidence is used for the paired text-only baseline.
    baseline = json.loads((PRIOR / 'requests/pairs-baseline-01.json').read_text())
    sections = json.loads(baseline['messages'][0]['content'].split('\nINPUT:\n', 1)[1])['sections']
    old = json.loads((HERE.parent / '20260909-008-text-image-ab/manifest.json').read_text())
    settings = {**old['settings'], 'max_tokens': 12288, 'seed': 28001}
    schema = deepcopy(extraction['schema'])
    schema['properties']['concepts']['items']['properties']['c']['items']['properties']['m'] = {'type': 'string', 'minLength': 1}
    save(package / 'config.json', {'source_sha256': sha(source), 'page_count': 45, 'render_dpi': 144,
        'output_budget': 12288, 'prompt': prompt, 'settings': settings, 'schema': schema,
        'sections': sections, 'policy': 'Stop on context insufficiency; no resizing, truncation or chunking.'})
    (package / 'preflight.py').write_bytes((HERE / 'preflight.py').read_bytes())
    (package / 'render.py').write_bytes((HERE / 'render.py').read_bytes())
    save(HERE / 'manifest.json', {'source_sha256': sha(source), 'source_page_count': 45, 'render_dpi': 144,
        'conditions': ['text_only_whole_document', 'image_only_whole_document'],
        'prompt_sha256': hashlib.sha256(prompt.encode()).hexdigest(), 'settings': settings,
        'reference_file_sha256': sha(PRIOR / 'private-reference.json'),
        'baseline_sections_sha256': hashlib.sha256(json.dumps(sections, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
        'planned_model_calls_if_context_sufficient': 2,
        'policy': 'Same graph extraction prompt and output schema; no supplied reference endpoints or answers. Image-only arm contains no native/OCR text. Stop and report context insufficiency to user.',
        'score_policy': 'Review every emitted relation against the PDF for supported type, direction and endpoint scope; also align the resulting graph with the 60 candidate-reference cases. Report generated-edge precision separately from reference coverage. No graph-level score until full outputs exist.'})
    with tarfile.open(HERE / 'inputs.tar.gz', 'w:gz') as tar:
        for path in sorted(package.iterdir()):
            tar.add(path, arcname=path.name)
    print(json.dumps({'page_count': 45, 'output_budget': 12288, 'archive_bytes': (HERE / 'inputs.tar.gz').stat().st_size}))


if __name__ == '__main__':
    main()
