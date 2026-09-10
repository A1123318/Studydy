"""Render all source pages at the fixed experiment resolution."""
import hashlib
import json
import os
from pathlib import Path

import pymupdf

HERE = Path(__file__).resolve().parent
os.umask(0o077)
config = json.loads((HERE / 'config.json').read_text())
source = HERE / 'source.pdf'
assert hashlib.sha256(source.read_bytes()).hexdigest() == config['source_sha256']
directory = HERE / 'images'
directory.mkdir(exist_ok=True)
records = []
with pymupdf.open(source) as document:
    assert len(document) == config['page_count']
    for index, page in enumerate(document, 1):
        pymupdf.TOOLS.mupdf_warnings(reset=True)
        pix = page.get_pixmap(dpi=config['render_dpi'], colorspace=pymupdf.csRGB, alpha=False)
        raw = pix.tobytes('png')
        path = directory / f'page-{index:02}.png'
        path.write_bytes(raw)
        records.append({'page': index, 'path': str(path.relative_to(HERE)), 'evidence_id': 900000 + index,
                        'width': pix.width, 'height': pix.height, 'sha256': hashlib.sha256(raw).hexdigest(),
                        'warnings': pymupdf.TOOLS.mupdf_warnings(reset=True).splitlines()})
(HERE / 'render-manifest.json').write_text(json.dumps(records, indent=2) + '\n')
print('RENDERED', len(records), 'pages', flush=True)
