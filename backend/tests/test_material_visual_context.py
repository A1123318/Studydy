from copy import deepcopy
import hashlib
import json

import httpx
import pymupdf
import pytest

from knowledge_map.structure import validate_knowledge_structure
import pdf_evidence.material_pipeline as pipeline
from pdf_evidence.ocr_page_evidence import build_page_evidence, extract_page, page_needs
from pdf_evidence.visual_context import VisualPage
from runtime.semantic_service import SemanticServiceError, material_request_fits, request_semantics
from test_material_pipeline_v1 import _request, _semantic, _settings


def _diagram_pdf(path, count=1):
    with pymupdf.open() as document:
        for _ in range(count):
            page = document.new_page(width=400, height=400)
            page.insert_text((30, 45), "Components of a controller", fontsize=18)
            page.insert_text((45, 140), "Input")
            page.insert_text((240, 140), "Output")
            page.draw_rect((30, 100, 140, 160))
            page.draw_rect((220, 100, 350, 160))
            page.draw_line((140, 130), (220, 130))
        document.save(path)


def _visual_request(tmp_path, count=1):
    path = tmp_path / "public-diagram.pdf"
    _diagram_pdf(path, count)
    sha = hashlib.sha256(path.read_bytes()).hexdigest()
    visuals = []
    rows = []
    with pymupdf.open(path) as document:
        for number in range(1, count + 1):
            page = extract_page(document, sha, number)
            reference = {
                "material_id": page["material_id"], "page": number,
                "page_ref": page["page_ref"], "render_sha256": page["render"]["sha256"],
            }
            visuals.append(VisualPage(reference, page["png_bytes"]))
            rows.append([number - 1, number, "paragraph", "A controller has an input and an output."])
    request = {
        "material_id": f"material:sha256:{sha}",
        "sections": [{"title": "Controller", "evidence": rows}],
        "existing_concepts": [],
        "visual_pages": [visual.reference for visual in visuals],
    }
    return request, tuple(visuals)


def test_native_vector_diagram_needs_visual_context_without_ocr(tmp_path):
    path = tmp_path / "public.pdf"
    _diagram_pdf(path)
    with pymupdf.open(path) as document:
        page = extract_page(document, hashlib.sha256(path.read_bytes()).hexdigest(), 1)
    assert page_needs(page) == {"needs_ocr": False, "needs_visual_context": True}


def test_cover_accents_and_background_are_not_visual_semantics(tmp_path):
    path = tmp_path / "public-cover.pdf"
    with pymupdf.open() as document:
        pdf_page = document.new_page(width=600, height=400)
        pdf_page.draw_rect((0, 0, 600, 400), fill=(0.9, 0.9, 0.9), color=None)
        pdf_page.draw_rect((80, 130, 96, 175), fill=(0.1, 0.2, 0.5), color=None)
        pdf_page.draw_rect((80, 220, 96, 265), fill=(0.1, 0.5, 0.2), color=None)
        pdf_page.draw_line((100, 200), (550, 200))
        pdf_page.insert_text((110, 160), "Public lesson", fontsize=32)
        pdf_page.insert_text((110, 250), "Course introduction", fontsize=24)
        document.save(path)
    with pymupdf.open(path) as document:
        page = extract_page(document, hashlib.sha256(path.read_bytes()).hexdigest(), 1)
    assert page_needs(page) == {"needs_ocr": False, "needs_visual_context": False}


def test_unrecovered_ocr_figure_selects_visual_context_without_becoming_text(tmp_path):
    path = tmp_path / "public.pdf"
    with pymupdf.open() as document:
        pdf_page = document.new_page(width=400, height=400)
        pdf_page.insert_text((30, 45), "Components of a controller")
        document.save(path)
    with pymupdf.open(path) as document:
        page = extract_page(document, hashlib.sha256(path.read_bytes()).hexdigest(), 1)
    page["images"] = [{"bbox": [40, 100, 350, 350]}]
    artifact = build_page_evidence(page, [{"type": "image", "text": "\n", "bbox": [100, 250, 875, 875]}],
                                   input_binding={}, produced_at="x")
    assert artifact["needs_ocr"] and artifact["needs_visual_context"]
    assert [(block["source"], block["text"]) for block in artifact["evidence_blocks"]] == [
        ("native_text", "Components of a controller"),
    ]
    assert artifact["processing"] == "partial"


@pytest.mark.parametrize("kind, expected", [
    ("text", (False, False)),
    ("logo", (False, False)),
    ("margin_art", (False, False)),
    ("raster_text", (True, False)),
    ("raster_diagram", (True, True)),
    ("scan", (True, False)),
])
def test_ocr_and_visual_questions_are_independent(tmp_path, kind, expected):
    path = tmp_path / "public.pdf"
    with pymupdf.open() as document:
        pdf_page = document.new_page(width=400, height=400)
        if kind != "scan":
            text = "The diagram shows the connections." if kind == "raster_diagram" else "A public teaching statement."
            pdf_page.insert_text((30, 55), text)
        document.save(path)
    with pymupdf.open(path) as document:
        page = extract_page(document, hashlib.sha256(path.read_bytes()).hexdigest(), 1)
    if kind == "logo":
        page["images"] = [{"bbox": [370, 5, 390, 25]}]
    elif kind == "margin_art":
        page["images"] = [{"bbox": [80, 5, 320, 25]}]
    elif kind.startswith("raster") or kind == "scan":
        page["images"] = [{"bbox": [30, 100, 360, 350]}]
    needs = page_needs(page)
    assert (needs["needs_ocr"], needs["needs_visual_context"]) == expected


@pytest.mark.parametrize("count", [1, 3])
def test_same_multimodal_messages_reach_tokenizer_and_resident_qwen(tmp_path, count):
    request, visuals = _visual_request(tmp_path, count)
    observed = []
    def respond(message):
        body = json.loads(message.content)
        observed.append((message.url.path, body))
        if message.url.path == "/tokenize":
            return httpx.Response(200, json={"count": 100, "max_model_len": 32768})
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": '{"concepts":[],"relations":[]}'}}]})
    lock = _settings(tmp_path)["runtime_lock"]
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert material_request_fits(client, lock, request, visual_pages=visuals)
        request_semantics(client, runtime_lock=lock, task="material_semantics", request=request,
                          response_schema={}, visual_pages=visuals)
    full_messages = observed[0][1]["messages"]
    assert observed[-2][1]["messages"] == observed[-1][1]["messages"] == full_messages
    parts = full_messages[0]["content"]
    assert sum(part["type"] == "image_url" for part in parts) == count
    assert all("png_bytes" not in str(visual) for visual in visuals)
    # Fresh textual Evidence is budgeted without catalog or image tokens.
    if count > 1:  # An indivisible single Evidence unit only needs the full-context check.
        assert isinstance(observed[1][1]["messages"][0]["content"], str)
        assert "data:image" not in observed[1][1]["messages"][0]["content"]


@pytest.mark.parametrize("failure", ["wrong_material", "wrong_page", "wrong_hash", "missing_payload", "duplicate", "unrelated_page", "assessment"])
def test_invalid_visual_input_is_rejected_before_any_network(tmp_path, failure):
    request, visuals = _visual_request(tmp_path)
    task = "material_semantics"
    if failure == "wrong_material":
        request["material_id"] = "material:sha256:" + "0" * 64
    elif failure == "wrong_page":
        request["visual_pages"][0]["page_ref"] = "page:sha256:" + "0" * 64
    elif failure == "wrong_hash":
        request["visual_pages"][0]["render_sha256"] = "0" * 64
    elif failure == "missing_payload":
        visuals = ()
    elif failure == "duplicate":
        request["visual_pages"] *= 2
        visuals *= 2
    elif failure == "unrelated_page":
        request["sections"][0]["evidence"][0][1] = 2
    else:
        task = "assessment"
    def unexpected(_):
        raise AssertionError("invalid image must not leave the process")
    with httpx.Client(transport=httpx.MockTransport(unexpected)) as client:
        with pytest.raises(SemanticServiceError, match="SEMANTIC_VISUAL_REFERENCE_INVALID"):
            request_semantics(client, runtime_lock=_settings(tmp_path)["runtime_lock"], task=task,
                              request=request, response_schema={}, visual_pages=visuals)


def test_four_images_fail_packing_without_loading_or_sending_them(tmp_path):
    request, visuals = _visual_request(tmp_path, 4)
    with httpx.Client(transport=httpx.MockTransport(lambda _: pytest.fail("network not expected"))) as client:
        assert not material_request_fits(client, _settings(tmp_path)["runtime_lock"], request)
        with pytest.raises(SemanticServiceError, match="SEMANTIC_VISUAL_REFERENCE_INVALID"):
            request_semantics(client, runtime_lock=_settings(tmp_path)["runtime_lock"], task="material_semantics",
                              request=request, response_schema={}, visual_pages=visuals)


@pytest.mark.parametrize("count, fits", [(23552, True), (23553, False)])
def test_low_candidate_reserves_output_and_margin_within_32k(tmp_path, count, fits):
    request, visuals = _visual_request(tmp_path)
    lock = _settings(tmp_path)["runtime_lock"]
    lock["material_semantics"].update(max_new_input_tokens=8192, max_tokens=8192)
    lock["material_semantics"]["generation"]["chat_template_kwargs"]["reasoning_effort"] = "low"
    pipeline.validate_runtime_lock(lock)
    calls = []
    def respond(message):
        body = json.loads(message.content)
        calls.append(message.url.path)
        assert body["chat_template_kwargs"]["reasoning_effort"] == "low"
        if message.url.path == "/tokenize":
            return httpx.Response(200, json={"count": count, "max_model_len": 32768})
        assert body["max_tokens"] == 8192
        return httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"content": '{"concepts":[]}'}}]})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert material_request_fits(client, lock, request, visual_pages=visuals) is fits
        with pytest.raises(SemanticServiceError, match="SEMANTIC_OUTPUT_TRUNCATED" if fits else "SEMANTIC_INPUT_TOO_LARGE"):
            request_semantics(client, runtime_lock=lock, task="material_semantics", request=request,
                              response_schema={}, visual_pages=visuals)
    assert calls.count("/v1/chat/completions") == int(fits)


def test_pipeline_splits_visual_bundles_and_persists_only_bound_provenance(tmp_path, monkeypatch):
    path = tmp_path / "four-diagrams.pdf"
    _diagram_pdf(path, 4)
    monkeypatch.setattr(pipeline, "start_ocr_process", lambda _: pytest.fail("native labels must not load OCR"))
    observed = []
    locations = []
    original = pipeline._page_evidence
    def capture(*args):
        locations.append(args[-1])
        return original(*args)
    monkeypatch.setattr(pipeline, "_page_evidence", capture)
    semantic = _semantic(observed)
    def call(client, **arguments):
        assert 1 <= len(arguments["visual_pages"]) <= 3
        assert all(visual.matches_render() for visual in arguments["visual_pages"])
        return semantic(client, **arguments)
    def respond(message):
        assert message.url.path == "/tokenize"
        return httpx.Response(200, json={"count": 100, "max_model_len": 32768})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        result = pipeline.analyze_material(_request(path), _settings(tmp_path), client=client, semantic_call=call)
    assert result["metrics"]["ocr_calls"] == 0
    assert result["metrics"]["semantic_calls"] == 2
    assert [len(request["visual_pages"]) for request in observed] == [3, 1]
    assert {reference["page"] for request in observed for reference in request["visual_pages"]} == {1, 2, 3, 4}
    assert validate_knowledge_structure(result)
    assert "data:image" not in json.dumps(result) and "png_bytes" not in json.dumps(result)
    assert all(not location.exists() for location in locations)
    altered = deepcopy(result)
    altered["provenance"]["visual_requests"][0]["pages"][0]["material_id"] = "material:sha256:" + "0" * 64
    # Recompute revision so this tests provenance validation, not only hashing.
    from knowledge_map.structure import _revision
    altered["revision"] = _revision(altered)
    assert not validate_knowledge_structure(altered)
