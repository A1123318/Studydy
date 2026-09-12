from copy import deepcopy
import json
from pathlib import Path

import httpx
import pytest

import runtime.semantic_service as semantic_service

from runtime.semantic_service import SemanticServiceError, material_request_fits, preflight_semantic_service, request_semantics


def _lock() -> dict:
    return json.loads((Path(__file__).parents[2] / "local_ai/runtime-lock.json").read_text())


@pytest.mark.parametrize("endpoint", [None, "https://semantic.example.test/"])
def test_preflight_and_all_tasks_use_the_same_resident_service(monkeypatch, endpoint):
    monkeypatch.delenv("STUDYDY_SEMANTIC_BASE_URL", raising=False)
    if endpoint is not None:
        monkeypatch.setenv("STUDYDY_SEMANTIC_BASE_URL", endpoint)
    monkeypatch.setenv("STUDYDY_SEMANTIC_API_KEY", "mock-only-token")
    paths: list[str] = []

    def respond(request: httpx.Request) -> httpx.Response:
        assert str(request.url).startswith((endpoint or "http://127.0.0.1:8000").rstrip("/") + "/")
        assert request.headers["Authorization"] == "Bearer mock-only-token"
        paths.append(request.url.path)
        if request.url.path == "/health": return httpx.Response(200)
        if request.url.path == "/version": return httpx.Response(200, json={"version": "0.28.0"})
        if request.url.path == "/v1/models": return httpx.Response(200, json={"data": [{"id": "Qwen/Qwen3.8-27B-FP8", "max_model_len": 32768}]})
        if request.url.path == "/tokenize": return httpx.Response(200, json={"count": 50, "max_model_len": 32768})
        task = json.loads(request.content)["response_format"]["json_schema"]["name"]
        body = json.loads(request.content)
        generation = _lock()["material_semantics"]["generation"]
        if task == "material_semantics":
            assert {key: body[key] for key in generation} == generation
        elif task == "assessment_check":
            check_generation = _lock()["assessment"]["check_generation"]
            assert {key: body[key] for key in check_generation} == check_generation
        else:
            assert body["chat_template_kwargs"] == {"enable_thinking": False}
            assert (set(generation) - {"chat_template_kwargs"}).isdisjoint(body)
        content = {"material_semantics": {"concepts": [], "relations": []}, "assessment": {"schema": "assessment-semantics-response/v2", "candidates": []}, "assessment_check": {"candidates": []}}[task]
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(content)}}]})

    real_client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    with semantic_service.semantic_client() as client:
        preflight_semantic_service(_lock(), client=client)
        schema = {"type": "object"}
        for task in ("material_semantics", "assessment", "assessment_check"):
            result = request_semantics(client, runtime_lock=_lock(), task=task, request={"schema": "x"}, response_schema=schema)
            assert ("concepts" if task == "material_semantics" else "candidates") in result
    assert paths.count("/v1/chat/completions") == 3
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


@pytest.mark.parametrize("count, fits", [(28672, True), (28673, False)])
def test_material_packing_and_generation_share_exact_token_budget(count, fits):
    requests = []
    def respond(request):
        body = json.loads(request.content)
        requests.append((request.url.path, body))
        if request.url.path == "/tokenize":
            return httpx.Response(200, json={"count": count, "max_model_len": 32768})
        assert body["max_tokens"] == 4096
        return httpx.Response(200, json={"choices": [{
            "finish_reason": "length", "message": {"content": '{"concepts":[]}'},
        }]})
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        arguments = dict(runtime_lock=_lock(), task="material_semantics", request={"sections": [{"evidence": [[0, 1, "code", "x"]]}]}, response_schema={})
        assert material_request_fits(client, _lock(), arguments["request"]) is fits
        with pytest.raises(SemanticServiceError, match="SEMANTIC_OUTPUT_TRUNCATED" if fits else "SEMANTIC_INPUT_TOO_LARGE"):
            request_semantics(client, **arguments)
    assert requests[0][1]["messages"] == requests[1][1]["messages"]
    template = {"enable_thinking": True, "reasoning_effort": "xhigh"}
    assert requests[0][1]["chat_template_kwargs"] == template
    assert requests[1][1]["chat_template_kwargs"] == template
    if fits:
        assert requests[2][1]["chat_template_kwargs"] == template
    assert sum(path == "/v1/chat/completions" for path, _ in requests) == int(fits)


def test_insecure_remote_or_second_runtime_contract_is_rejected_before_network(monkeypatch):
    lock = _lock()
    monkeypatch.setenv("STUDYDY_SEMANTIC_BASE_URL", "http://example.test:8000")
    with httpx.Client(transport=httpx.MockTransport(lambda _request: (_ for _ in ()).throw(AssertionError()))) as client:
        with pytest.raises(SemanticServiceError, match="SEMANTIC_SERVICE_CONFIG_INVALID"):
            request_semantics(client, runtime_lock=lock, task="material_semantics", request={}, response_schema={})

    monkeypatch.delenv("STUDYDY_SEMANTIC_BASE_URL")
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


@pytest.mark.parametrize("fresh_count,fits", [(1536, True), (1537, False)])
def test_material_bundle_budget_excludes_existing_catalog(fresh_count, fits):
    """舊概念目錄只佔 context；新增教材另有輸出容量預算。"""
    calls = []
    def respond(request):
        body = json.loads(request.content)
        material = json.loads(body["messages"][-1]["content"].split("\nINPUT:\n", 1)[1])
        calls.append(material)
        return httpx.Response(200, json={"count": 6000 if material["existing_concepts"] else fresh_count, "max_model_len": 32768})
    material = {"existing_concepts": [{"k": "array", "l": "Array", "a": [], "c": ["Existing claim"], "e": [0]}],
                "sections": [{"title": "New material", "evidence": [[1, 1, "paragraph", "First"], [2, 2, "paragraph", "Second"]]}]}
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        assert material_request_fits(client, _lock(), material) is fits
    assert calls[0] == material
    assert calls[1]["existing_concepts"] == []
    assert calls[1]["sections"] == material["sections"]


@pytest.mark.parametrize("endpoint", ["", "https://user:password@example.test", "https://example.test?key=value", "https://example.test/#secret", "https://example.test/v1", "https://[invalid", "https://example.test:invalid", "https://example.test\n"])
def test_invalid_endpoint_is_rejected_without_echoing_value(monkeypatch, endpoint):
    monkeypatch.setenv("STUDYDY_SEMANTIC_BASE_URL", endpoint)
    with pytest.raises(SemanticServiceError) as failure:
        semantic_service.semantic_base_url()
    assert str(failure.value) == "SEMANTIC_SERVICE_CONFIG_INVALID"


def test_bearer_uses_only_new_environment_variable():
    assert semantic_service._headers({"VLLM_API_KEY": "ignored-test-value"}) == {}
    assert semantic_service._headers({"STUDYDY_SEMANTIC_API_KEY": ""}) == {}
    with pytest.raises(SemanticServiceError) as failure:
        semantic_service._headers({"STUDYDY_SEMANTIC_API_KEY": "invalid\r\nvalue"})
    assert str(failure.value) == "SEMANTIC_SERVICE_CONFIG_INVALID"


def test_redirect_does_not_forward_bearer(monkeypatch):
    requests = []
    def respond(request):
        requests.append(request)
        return httpx.Response(307, headers={"location": "https://other.example.test/health"})
    real_client = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: real_client(transport=httpx.MockTransport(respond), **kwargs))
    with semantic_service.semantic_client(environment={"STUDYDY_SEMANTIC_API_KEY": "mock-only-token"}) as client:
        with pytest.raises(SemanticServiceError, match="SEMANTIC_SERVICE_UNAVAILABLE"):
            preflight_semantic_service(_lock(), client=client)
    assert all(request.url.host == "127.0.0.1" for request in requests)


@pytest.mark.parametrize("failure", [401, 404, "timeout", "version"])
def test_remote_preflight_keeps_failure_contract(monkeypatch, failure):
    monkeypatch.setenv("STUDYDY_SEMANTIC_BASE_URL", "https://semantic.example.test")
    def respond(request):
        assert request.url.host == "semantic.example.test"
        if failure == "timeout":
            raise httpx.ReadTimeout("mock timeout", request=request)
        if isinstance(failure, int):
            return httpx.Response(failure)
        if request.url.path == "/health":
            return httpx.Response(200)
        if request.url.path == "/version":
            return httpx.Response(200, json={"version": "incompatible"})
        if request.url.path == "/v1/models":
            return httpx.Response(200, json={"data": [{"id": "Qwen/Qwen3.8-27B-FP8", "max_model_len": 32768}]})
        return httpx.Response(200, json={"count": 1, "max_model_len": 32768})
    reason = "SEMANTIC_SERVICE_TIMEOUT" if failure == "timeout" else "SEMANTIC_SERVICE_IDENTITY_MISMATCH" if failure == "version" else "SEMANTIC_SERVICE_UNAVAILABLE"
    with httpx.Client(transport=httpx.MockTransport(respond)) as client:
        with pytest.raises(SemanticServiceError, match=reason):
            preflight_semantic_service(_lock(), client=client)
