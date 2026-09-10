from copy import deepcopy
import json
from pathlib import Path

import httpx
import pytest

from runtime.semantic_service import SemanticServiceError, material_request_fits, parse_material_final, preflight_semantic_service, request_semantics


def _lock() -> dict:
    return json.loads((Path(__file__).parents[2] / "local_ai/runtime-lock.json").read_text())


def test_preflight_and_both_tasks_use_the_same_resident_service():
    paths: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path == "/health": return httpx.Response(200)
        if request.url.path == "/version": return httpx.Response(200, json={"version": "0.28.0"})
        if request.url.path == "/v1/models": return httpx.Response(200, json={"data": [{"id": "Qwen/Qwen3.8-27B-FP8", "max_model_len": 32768}]})
        if request.url.path == "/tokenize": return httpx.Response(200, json={"count": 50, "max_model_len": 32768})
        body = json.loads(request.content)
        task = "material_semantics" if body["response_format"]["type"] == "structural_tag" else body["response_format"]["json_schema"]["name"]
        generation = _lock()["material_semantics"]["generation"]
        if task == "material_semantics":
            assert {key: body[key] for key in generation} == generation
            assert body["skip_special_tokens"] is False
        else:
            assert body["chat_template_kwargs"] == {"enable_thinking": False}
            assert (set(generation) - {"chat_template_kwargs"}).isdisjoint(body)
        content = {"material_semantics": {"concepts": [], "relations": []}, "assessment": {"schema": "assessment-semantics-response/v2", "candidates": []}}[task]
        encoded = json.dumps(content)
        if task == "material_semantics":
            encoded = "<final_json>" + encoded + "</final_json>"
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": encoded}}]})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        preflight_semantic_service(_lock(), client=client)
        schema = {"type": "object"}
        for task in ("material_semantics", "assessment"):
            result = request_semantics(client, runtime_lock=_lock(), task=task, request={"schema": "x"}, response_schema=schema)
            assert ("concepts" if task == "material_semantics" else "candidates") in result
    assert paths.count("/v1/chat/completions") == 2
    assert set(paths) == {"/health", "/version", "/v1/models", "/tokenize", "/v1/chat/completions"}


def test_assessment_tokenizer_and_generation_both_disable_thinking():
    """出題的 token 預算與實際推論使用相同的非 thinking template。"""
    observed = []
    def respond(request):
        body = json.loads(request.content)
        observed.append((request.url.path, body["chat_template_kwargs"]))
        if request.url.path == "/tokenize":
            return httpx.Response(200, json={"count": 50, "max_model_len": 32768})
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": '{"schema":"assessment-semantics-response/v2","candidates":[]}'}}]})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        request_semantics(client, runtime_lock=_lock(), task="assessment", request={}, response_schema={})
    assert observed == [
        ("/tokenize", {"enable_thinking": False}),
        ("/v1/chat/completions", {"enable_thinking": False}),
    ]


@pytest.mark.parametrize("count, fits", [(23552, True), (23553, False)])
def test_material_packing_and_generation_share_exact_token_budget(count, fits):
    requests = []
    def respond(request):
        body = json.loads(request.content)
        requests.append((request.url.path, body))
        if request.url.path == "/tokenize":
            return httpx.Response(200, json={"count": count, "max_model_len": 32768})
        assert body["max_tokens"] == 8192
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "length", "message": {"content": '{"concepts":[]}'},
        }]})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        arguments = dict(runtime_lock=_lock(), task="material_semantics", request={"sections": [{"evidence": [[0, 1, "code", "x"]]}]}, response_schema={})
        assert material_request_fits(client, _lock(), arguments["request"]) is fits
        with pytest.raises(SemanticServiceError, match="SEMANTIC_OUTPUT_TRUNCATED" if fits else "SEMANTIC_INPUT_TOO_LARGE"):
            request_semantics(client, **arguments)
    assert requests[0][1]["messages"] == requests[1][1]["messages"]
    template = {"enable_thinking": False}
    assert requests[0][1]["chat_template_kwargs"] == template
    assert requests[1][1]["chat_template_kwargs"] == template
    if fits:
        assert requests[2][1]["chat_template_kwargs"] == template
    assert sum(path == "/v1/chat/completions" for path, _ in requests) == int(fits)


def test_non_loopback_or_second_runtime_contract_is_rejected_before_network():
    lock = _lock()
    lock["semantic_service"]["base_url"] = "http://example.test:8000"
    with httpx.Client(transport=httpx.MockTransport(lambda _request: (_ for _ in ()).throw(AssertionError()))) as client:
        with pytest.raises(SemanticServiceError, match="SEMANTIC_SERVICE_CONFIG_INVALID"):
            request_semantics(client, runtime_lock=lock, task="material_semantics", request={}, response_schema={})

    second = deepcopy(_lock())
    second["semantic_service"]["model_id"] = "Qwen/second-model"
    with httpx.Client(transport=httpx.MockTransport(lambda _request: (_ for _ in ()).throw(AssertionError()))) as client:
        with pytest.raises(SemanticServiceError):
            request_semantics(client, runtime_lock=second, task="assessment", request={}, response_schema={})


def test_preflight_rejects_more_than_one_served_model():
    def respond(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/health":
            return httpx.Response(200)
        if request.url.path == "/version":
            return httpx.Response(200, json={"version": "0.28.0"})
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={
                "data": [
                    {"id": "Qwen/Qwen3.8-27B-FP8", "max_model_len": 32768},
                    {"id": "second-model", "max_model_len": 32768},
                ]
            })
        return httpx.Response(200, json={"count": 1, "max_model_len": 32768})

    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(SemanticServiceError, match="SEMANTIC_SERVICE_IDENTITY_MISMATCH"):
            preflight_semantic_service(_lock(), client=client)


@pytest.mark.parametrize("fresh_count,fits", [(8192, True), (8193, False)])
def test_material_bundle_budget_excludes_existing_catalog(fresh_count, fits):
    """舊概念目錄只佔 context；新增教材另有輸出容量預算。"""
    calls = []
    def respond(request):
        body = json.loads(request.content)
        material = json.loads(body["messages"][-1]["content"].split("\nINPUT:\n", 1)[1])
        calls.append(material)
        return httpx.Response(200, json={"count": 14000 if material["existing_concepts"] else fresh_count, "max_model_len": 32768})
    material = {"existing_concepts": [{"k": "array", "l": "Array", "a": [], "c": ["Existing claim"], "e": [0]}],
                "sections": [{"title": "New material", "evidence": [[1, 1, "paragraph", "First"], [2, 2, "paragraph", "Second"]]}]}
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert material_request_fits(client, _lock(), material) is fits
    assert calls[0] == material
    assert calls[1]["existing_concepts"] == []
    assert calls[1]["sections"] == material["sections"]


def test_material_reasoning_prefix_is_discarded_and_quoted_delimiters_are_preserved():
    assert parse_material_final('private preparatory text</think>\n<final_json>{"literal":"</final_json>"}</final_json>') == {"literal": "</final_json>"}
    assert parse_material_final('</think><final_json>{"concepts":[],"relations":[]}</final_json>') == {"concepts": [], "relations": []}


@pytest.mark.parametrize("content", [
    '{"concepts":[],"relations":[]}',
    '<final_json>{"concepts":[],"relations":[]}</final_json>',
    'private text</think><final_json>{"concepts":[],"relations":[]}',
    'private text</think><final_json>{"concepts":[],"relations":[]}</final_json>extra',
    'private text</think><final_json>{"x":1,"x":2}</final_json>',
])
def test_material_final_boundary_fails_closed_without_exposing_prefix(content):
    with pytest.raises(SemanticServiceError) as error:
        parse_material_final(content)
    assert str(error.value) == "SEMANTIC_RESPONSE_INVALID"


def test_material_relation_judgment_uses_low_with_full_context_budget():
    seen = []
    def respond(request):
        body = json.loads(request.content)
        seen.append((request.url.path, body))
        assert body["chat_template_kwargs"] == {"enable_thinking": True, "reasoning_effort": "low"}
        if request.url.path == "/tokenize":
            return httpx.Response(200, json={"count": 12000, "max_model_len": 32768})
        assert body["seed"] == 17001
        assert "Concepts, Claims, Relations" not in body["messages"][0]["content"]
        assert "A_to_B means" in body["messages"][0]["content"]
        assert body["response_format"]["format"]["type"] == "sequence"
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {
            "content": '</think><final_json>{"decisions":[]}</final_json>'}}]})
    document = {"pairs": [], "sections": [{"title": "Sources", "evidence": [[0, 1, "paragraph", "First"], [1, 2, "paragraph", "Second"]]}]}
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert material_request_fits(client, _lock(), document, relation_judgment=True)
        assert request_semantics(client, runtime_lock=_lock(), task="material_relations", request=document, response_schema={}) == {"decisions": []}
    assert seen[0][1]["messages"] == seen[-1][1]["messages"]


def test_disabled_material_thinking_requires_direct_final_region():
    assert parse_material_final('<final_json>{"concepts":[],"relations":[]}</final_json>', thinking=False) == {"concepts": [], "relations": []}
    with pytest.raises(SemanticServiceError, match="SEMANTIC_RESPONSE_INVALID"):
        parse_material_final('unexpected</think><final_json>{"concepts":[],"relations":[]}</final_json>', thinking=False)
