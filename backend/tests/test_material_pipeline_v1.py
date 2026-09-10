import hashlib
import json
from pathlib import Path

import pymupdf
import httpx
import pytest

import pdf_evidence.material_pipeline as pipeline


class Client:
    def post(self, url, **kwargs):
        assert url.endswith("/tokenize")
        return httpx.Response(200, json={"count": 100, "max_model_len": 32768}, request=httpx.Request("POST", url))


def _settings(tmp_path: Path) -> dict:
    lock = json.loads((Path(__file__).parents[2] / "local_ai/runtime-lock.json").read_text())
    return {
        "private_runtime_root": str(tmp_path / "runtime"),
        "runtime_lock": lock,
        "python_executable": str(tmp_path / "ocr/runtime/bin/python3.12"),
        "site_packages": str(tmp_path / "ocr/runtime/lib/python3.12/site-packages"),
        "ocr_model_root": str(tmp_path / "models/unlimited-ocr"),
    }


def _pdf(path: Path, pages: int, *, blank_first: bool = False) -> None:
    document = pymupdf.open()
    for page_number in range(1, pages + 1):
        page = document.new_page(width=612, height=792)
        if not (blank_first and page_number == 1):
            if page_number == 1:
                page.insert_text((72, 72), "Public Algorithms", fontsize=20)
            page.insert_text((72, 120), f"Public lesson {page_number} explains a deterministic learning concept with evidence.", fontsize=12)
    document.save(path)
    document.close()


def _request(path: Path) -> dict:
    return {
        "media_type": "application/pdf",
        "source_path": str(path),
        "expected_source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
    }


def _semantic(calls: list[dict]):
    def call(_client, **arguments):
        request = arguments["request"]
        calls.append(request)
        allowed = arguments["response_schema"]["properties"]["concepts"]["items"]["properties"]["c"]["items"]["properties"]["s"]["items"]["enum"]
        assert allowed == [row[0] for section in request["sections"] for row in section["evidence"]]
        first = next(item for section in request["sections"] for item in section["evidence"] if item[2] != "heading")
        return {
            "concepts": [{
                "k": "algorithm", "l": "Algorithm", "a": [],
                "c": [{"m": None, "s": [first[0]]}],
            }],
            "relations": [],
        }
    return call


def test_eight_native_pages_use_one_unified_semantic_call_without_ocr(tmp_path, monkeypatch):
    source = tmp_path / "eight.pdf"
    _pdf(source, 8)
    monkeypatch.setattr(pipeline, "start_ocr_process", lambda _settings: (_ for _ in ()).throw(AssertionError("native PDF must not load OCR")))
    calls: list[dict] = []
    structure = pipeline.analyze_material(
        _request(source), _settings(tmp_path), client=Client(), semantic_call=_semantic(calls)
    )
    assert structure["metrics"]["semantic_calls"] == 1
    assert structure["metrics"]["ocr_calls"] == 0
    assert len(calls) == 1
    assert len({item[1] for section in calls[0]["sections"] for item in section["evidence"]}) == 8
    assert structure["initial_learning_path"][0]["concept_id"] == structure["concepts"][0]["concept_id"]


class FailedOcr:
    def request(self, _request, _timeout):
        raise pipeline.LocalAIError("CHILD_EXITED")

    def close(self):
        pass

    def abort(self):
        pass


def test_multiple_bundles_report_incremental_semantic_progress(tmp_path):
    """後面頁面尚未處理時，不能先把語意進度回報為整份完成。"""
    source = tmp_path / "three.pdf"
    _pdf(source, 3)
    class BudgetClient:
        def post(self, url, **kwargs):
            request = json.loads(kwargs["json"]["messages"][-1]["content"].split("\nINPUT:\n", 1)[1])
            count = 3000 * sum(len(section["evidence"]) for section in request["sections"])
            return httpx.Response(200, json={"count": count, "max_model_len": 32768}, request=httpx.Request("POST", url))
    calls = []
    progress = []
    pipeline.analyze_material(_request(source), _settings(tmp_path), client=BudgetClient(),
                              semantic_call=_semantic(calls), progress_callback=lambda stage, done, total: progress.append((stage, done, total)))
    assert len(calls) > 1
    assert {row[1] for call in calls for section in call["sections"] for row in section["evidence"]} == {1, 2, 3}
    completed = [done for stage, done, _total in progress if stage == "semantics"]
    assert completed == sorted(completed)
    assert completed[0] < 3 and completed[-1] == 3


def test_ocr_failure_excludes_only_scan_and_semantics_still_runs(tmp_path, monkeypatch):
    source = tmp_path / "mixed.pdf"
    _pdf(source, 2, blank_first=True)
    monkeypatch.setattr(pipeline, "start_ocr_process", lambda _settings: FailedOcr())
    calls: list[dict] = []
    structure = pipeline.analyze_material(
        _request(source), _settings(tmp_path), client=Client(), semantic_call=_semantic(calls)
    )
    assert structure["metrics"]["ocr_calls"] == 1
    assert structure["metrics"]["semantic_calls"] == 1
    assert structure["status"]["processing"] == "partial"
    assert structure["excluded_pages"] == [{
        "page_ref": structure["excluded_pages"][0]["page_ref"],
        "page": 1,
        "stage": "evidence",
        "reason_code": "CHILD_EXITED",
    }]
    assert {item[1] for section in calls[0]["sections"] for item in section["evidence"]} == {2}


def test_failed_ocr_sidecar_does_not_exclude_the_next_scan(tmp_path, monkeypatch):
    source = tmp_path / "two-scans.pdf"
    with pymupdf.open() as document:
        document.new_page(width=400, height=400)
        document.new_page(width=400, height=400)
        document.save(source)
    failed = FailedOcr()
    class SuccessfulOcr(FailedOcr):
        def request(self, request, _timeout):
            return {"schema": "local-ocr-response/v1", "request_id": request["request_id"],
                    "blocks": [{"type": "text", "text": "A public scanned teaching statement.",
                                "bbox": [100, 100, 800, 300]}]}
    starts = []
    def start(_settings):
        starts.append(True)
        return failed if len(starts) == 1 else SuccessfulOcr()
    monkeypatch.setattr(pipeline, "start_ocr_process", start)
    calls = []
    result = pipeline.analyze_material(_request(source), _settings(tmp_path), client=Client(), semantic_call=_semantic(calls))
    assert len(starts) == 2
    assert result["metrics"]["ocr_calls"] == 2
    assert [page["page"] for page in result["excluded_pages"]] == [1]
    assert {item[1] for section in calls[0]["sections"] for item in section["evidence"]} == {2}


@pytest.mark.parametrize("status", ["supported", "no_relation", "insufficient_evidence", "needs_review"])
def test_final_relations_are_judged_after_production_concepts(tmp_path, status):
    source = tmp_path / "generated-pairs.pdf"
    _pdf(source, 2)
    tasks = []
    def semantic(_client, **arguments):
        tasks.append(arguments["task"])
        document = arguments["request"]
        handle = next(row[0] for section in document["sections"] for row in section["evidence"] if row[2] != "heading")
        if arguments["task"] == "material_semantics":
            return {"concepts": [
                {"k": "component", "l": "Component", "a": [], "c": [{"m": None, "s": [handle]}]},
                {"k": "whole", "l": "Whole", "a": [], "c": [{"m": None, "s": [handle]}]},
            ], "relations": [{"s": "whole", "t": "component", "k": "prerequisite", "r": "Draft dependency proposal", "e": [handle], "c": 0.7}]}
        assert arguments["runtime_lock"]["material_semantics"]["relation_judgment"]["generation"]["chat_template_kwargs"] == {"enable_thinking": True, "reasoning_effort": "low"}
        assert document["context_scope"] == "whole_document"
        pair, = document["pairs"]
        assert pair["a_id"] == "component" and pair["b_id"] == "whole"
        assert {"type", "direction", "reason", "draft_confidence"}.isdisjoint(pair)
        assert pair["a_evidence"] == pair["b_evidence"] == [handle]
        return {"decisions": [{"id": pair["id"], "status": status,
                               "type": "part_of" if status == "supported" else "none",
                               "direction": "A_to_B" if status == "supported" else "none",
                               "evidence": [handle], "reason": "The component is a constituent of the whole."}]}
    graph = pipeline.analyze_material(_request(source), _settings(tmp_path), client=Client(), semantic_call=semantic)
    assert tasks == ["material_semantics", "material_relations"]
    assert len(graph["concepts"]) == 2
    if status == "supported":
        relation, = graph["relations"]
        labels = {c["concept_id"]: c["label"] for c in graph["concepts"]}
        assert (relation["type"], labels[relation["source_concept_id"]], labels[relation["target_concept_id"]]) == ("part_of", "Component", "Whole")
        assert relation["confidence"] == 0.7
    else:
        assert graph["relations"] == []
    assert graph["metrics"]["semantic_calls"] == 2


@pytest.mark.parametrize("failure", ["missing_decision", "supported_without_direction"])
def test_incomplete_relation_batch_fails_without_retry_or_publishing_draft(tmp_path, failure):
    source = tmp_path / "incomplete-pairs.pdf"
    _pdf(source, 1)
    tasks = []
    def semantic(_client, **arguments):
        tasks.append(arguments["task"])
        if arguments["task"] == "material_relations":
            if failure == "missing_decision":
                return {"decisions": []}
            pair = arguments["request"]["pairs"][0]
            return {"decisions": [{"id": pair["id"], "status": "supported", "type": "part_of",
                                   "direction": "none", "evidence": pair["a_evidence"], "reason": "Invalid direction encoding"}]}
        handle = next(row[0] for section in arguments["request"]["sections"] for row in section["evidence"])
        return {"concepts": [
            {"k": "a", "l": "First", "a": [], "c": [{"m": None, "s": [handle]}]},
            {"k": "b", "l": "Second", "a": [], "c": [{"m": None, "s": [handle]}]},
        ], "relations": [{"s": "a", "t": "b", "k": "part_of", "r": "Draft composition", "e": [handle], "c": 0.6}]}
    with pytest.raises(pipeline.MaterialAnalysisError, match="SEMANTIC_OUTPUT_INVALID"):
        pipeline.analyze_material(_request(source), _settings(tmp_path), client=Client(), semantic_call=semantic)
    assert tasks == ["material_semantics", "material_relations"]


def test_bounded_relation_batches_cover_every_generated_pair_once(tmp_path):
    source = tmp_path / "all-generated-pairs.pdf"
    _pdf(source, 3)
    settings = _settings(tmp_path)
    settings["runtime_lock"]["material_semantics"]["relation_judgment"]["max_pairs"] = 2
    seen = []
    progress = []
    def semantic(_client, **arguments):
        document = arguments["request"]
        handle = next(row[0] for section in document["sections"] for row in section["evidence"] if row[2] != "heading")
        if arguments["task"] == "material_semantics":
            keys = ["a", "b", "c", "d"]
            return {"concepts": [{"k": key, "l": f"Concept {key}", "a": [], "c": [{"m": None, "s": [handle]}]} for key in keys],
                    "relations": [{"s": a, "t": b, "k": "part_of", "r": "A proposed composition", "e": [handle], "c": 0.6}
                                  for i, a in enumerate(keys) for b in keys[i + 1:]]}
        assert len(document["pairs"]) <= 2
        assert ("semantics", 3, 3) not in progress
        assert {row[1] for section in document["sections"] for row in section["evidence"]} == {1, 2, 3}
        seen.extend((pair["a_id"], pair["b_id"]) for pair in document["pairs"])
        return {"decisions": [{"id": pair["id"], "status": "no_relation", "type": "none", "direction": "none", "evidence": [handle], "reason": "No direct composition is established."} for pair in document["pairs"]]}
    graph = pipeline.analyze_material(_request(source), settings, client=Client(), semantic_call=semantic,
                                      progress_callback=lambda stage, done, total: progress.append((stage, done, total)))
    assert len(seen) == len(set(seen)) == 6
    assert len(graph["concepts"]) == 4 and graph["relations"] == []
    assert graph["metrics"]["semantic_calls"] == 4
    assert progress.count(("semantics", 3, 3)) == 1
