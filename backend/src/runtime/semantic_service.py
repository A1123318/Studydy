from __future__ import annotations

import base64
from collections.abc import Mapping
from copy import deepcopy
import json
import os
from typing import Any
from urllib.parse import urlsplit

import httpx

from pdf_evidence.ocr_page_evidence import canonical_bytes
from pdf_evidence.visual_context import MAX_VISUAL_PAGES, VisualPage, validate_visual_reference


API_KEY_ENV = "VLLM_API_KEY"
CHAT_PATH = "/v1/chat/completions"
TOKENIZE_PATH = "/tokenize"
PREFLIGHT_TIMEOUT_SECONDS = 5
MAX_RESPONSE_BYTES = 1024 * 1024
INFERENCE_TIMEOUT = httpx.Timeout(None, connect=PREFLIGHT_TIMEOUT_SECONDS)
MATERIAL_OUTPUT_PROTOCOL = "think-then-json/v1"
FINAL_BEGIN = "<final_json>"
FINAL_END = "</final_json>"
MATERIAL_FINAL_INSTRUCTION = (
    "\nFinish the thinking region with </think>, then enclose the final JSON in "
    "<final_json> and </final_json>. Use these final delimiters only once, for the answer. "
    "Keep preparatory reasoning outside the final JSON; inside it include only the requested "
    "Concepts, Claims, Relations and concise learner-facing reasons. Emit nothing after </final_json>."
)


class SemanticServiceError(RuntimeError):
    """只攜帶固定 reason code，不攜帶教材或模型回應。"""

    def __init__(self, reason_code: str) -> None:
        super().__init__(reason_code)
        self.reason_code = reason_code


def _origin(value: Any) -> str:
    if not isinstance(value, str) or not value or "\x00" in value:
        raise SemanticServiceError("SEMANTIC_SERVICE_CONFIG_INVALID")
    parsed = urlsplit(value)
    try:
        port = parsed.port
    except ValueError:
        raise SemanticServiceError("SEMANTIC_SERVICE_CONFIG_INVALID") from None
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or port is None
        or not 1 <= port <= 65_535
    ):
        raise SemanticServiceError("SEMANTIC_SERVICE_CONFIG_INVALID")
    return value.rstrip("/")


def _headers(environment: Mapping[str, str] | None = None) -> dict[str, str]:
    value = (os.environ if environment is None else environment).get(API_KEY_ENV)
    if value is None:
        return {}
    if not value or len(value) > 4096 or any(character in value for character in "\x00\r\n"):
        raise SemanticServiceError("SEMANTIC_SERVICE_CONFIG_INVALID")
    return {"Authorization": f"Bearer {value}"}


def semantic_client(*, environment: Mapping[str, str] | None = None) -> httpx.Client:
    return httpx.Client(
        headers=_headers(environment),
        trust_env=False,
        follow_redirects=False,
        timeout=INFERENCE_TIMEOUT,
    )


def _service(lock: Any) -> dict[str, Any]:
    try:
        service = lock["semantic_service"]
        origin = _origin(service["base_url"])
        if (
            lock["schema"] != "studydy-runtime-lock/v16"
            or lock["python"] != "3.12"
            or service["model_id"] != "Qwen/Qwen3.8-27B-FP8"
            or service["max_model_len"] != 32768
            or service["max_num_seqs"] != 1
            or service["authentication"] != "environment-bearer:VLLM_API_KEY"
            or service["server"]["python"] != "3.12"
        ):
            raise SemanticServiceError("SEMANTIC_SERVICE_CONFIG_INVALID")
        return {**service, "base_url": origin}
    except (KeyError, TypeError):
        raise SemanticServiceError("SEMANTIC_SERVICE_CONFIG_INVALID") from None


def preflight_semantic_service(
    runtime_lock: dict[str, Any], *, client: httpx.Client | None = None
) -> None:
    """確認既有 resident vLLM 的版本、模型與 32K tokenizer contract。"""

    service = _service(runtime_lock)
    owned = client is None
    http = semantic_client() if client is None else client
    try:
        health = http.get(
            f"{service['base_url']}/health", timeout=PREFLIGHT_TIMEOUT_SECONDS
        )
        version = http.get(
            f"{service['base_url']}/version", timeout=PREFLIGHT_TIMEOUT_SECONDS
        )
        models = http.get(
            f"{service['base_url']}/v1/models", timeout=PREFLIGHT_TIMEOUT_SECONDS
        )
        tokenized = http.post(
            f"{service['base_url']}{TOKENIZE_PATH}",
            json={
                "model": service["model_id"],
                "messages": [{"role": "user", "content": "ready"}],
                "add_generation_prompt": True,
                "add_special_tokens": False,
            },
            timeout=PREFLIGHT_TIMEOUT_SECONDS,
        )
        for response in (health, version, models, tokenized):
            response.raise_for_status()
        version_body = version.json()
        model_body = models.json()
        token_body = tokenized.json()
    except httpx.TimeoutException as error:
        raise SemanticServiceError("SEMANTIC_SERVICE_TIMEOUT") from error
    except (httpx.HTTPError, UnicodeError, ValueError) as error:
        raise SemanticServiceError("SEMANTIC_SERVICE_UNAVAILABLE") from error
    finally:
        if owned:
            http.close()
    served = model_body.get("data") if isinstance(model_body, dict) else None
    model = next(
        (
            item
            for item in served or []
            if isinstance(item, dict) and item.get("id") == service["model_id"]
        ),
        None,
    )
    if (
        not isinstance(version_body, dict)
        or version_body.get("version") != service["server"]["version"]
        or not isinstance(served, list)
        or len(served) != 1
        or model is None
        or model.get("max_model_len") != service["max_model_len"]
        or not isinstance(token_body, dict)
        or type(token_body.get("count")) is not int
        or token_body["count"] < 1
        or token_body.get("max_model_len") != service["max_model_len"]
    ):
        raise SemanticServiceError("SEMANTIC_SERVICE_IDENTITY_MISMATCH")


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise SemanticServiceError("SEMANTIC_RESPONSE_INVALID")
        value[key] = item
    return value


def _reject_constant(_: str) -> None:
    raise SemanticServiceError("SEMANTIC_RESPONSE_INVALID")


def _material_prompt(task_lock: dict[str, Any]) -> str:
    if task_lock.get("output_protocol") != MATERIAL_OUTPUT_PROTOCOL:
        raise SemanticServiceError("SEMANTIC_SERVICE_CONFIG_INVALID")
    return task_lock["prompt"] + MATERIAL_FINAL_INSTRUCTION


def _material_response_format(schema: dict[str, Any]) -> dict[str, Any]:
    # The resident service has no reasoning parser. Keep its native thinking
    # boundary, then apply the same strict schema to the final answer region.
    return {"type": "structural_tag", "format": {"type": "sequence", "elements": [
        {"type": "tag", "begin": "", "content": {"type": "any_text", "excludes": [FINAL_BEGIN]}, "end": "</think>"},
        {"type": "regex", "pattern": "[ \\t\\r\\n]*"},
        {"type": "tag", "begin": FINAL_BEGIN,
         "content": {"type": "json_schema", "json_schema": deepcopy(schema)}, "end": FINAL_END},
    ]}}


def parse_material_final(content: Any) -> dict[str, Any]:
    """Return only final JSON; never return or retain the reasoning prefix."""
    if not isinstance(content, str):
        raise SemanticServiceError("SEMANTIC_RESPONSE_INVALID")
    prefix, marker, final = content.partition(FINAL_BEGIN)
    if not marker or not prefix.rstrip().endswith("</think>"):
        raise SemanticServiceError("SEMANTIC_RESPONSE_INVALID")
    final = final.lstrip()
    try:
        # Decode JSON before checking the delimiter, so a literal delimiter
        # inside a quoted technical string cannot terminate the answer early.
        result, end = json.JSONDecoder(
            object_pairs_hook=_unique_object, parse_constant=_reject_constant,
        ).raw_decode(final)
    except (UnicodeError, ValueError):
        raise SemanticServiceError("SEMANTIC_RESPONSE_INVALID") from None
    if not isinstance(result, dict) or final[end:].strip() != FINAL_END:
        raise SemanticServiceError("SEMANTIC_RESPONSE_INVALID")
    return result


def _messages(
    prompt: str, request: dict[str, Any], visual_pages: tuple[VisualPage, ...] = ()
) -> list[dict[str, Any]]:
    references = request.get("visual_pages", [])
    if not isinstance(references, list) or len(references) > MAX_VISUAL_PAGES:
        raise SemanticServiceError("SEMANTIC_VISUAL_REFERENCE_INVALID")
    if len(references) != len(visual_pages):
        raise SemanticServiceError("SEMANTIC_VISUAL_REFERENCE_INVALID")
    text = f"{prompt}\nINPUT:\n{canonical_bytes(request).decode('utf-8')}"
    if not references:
        return [{"role": "user", "content": text}]
    evidence_pages = {
        row[1] for section in request.get("sections", [])
        for row in section["evidence"]
    }
    seen = set()
    content = [{"type": "text", "text": text}]
    for reference, visual in zip(references, visual_pages, strict=True):
        if (
            not validate_visual_reference(
                reference, material_id=request.get("material_id"), evidence_pages=evidence_pages
            )
            or reference["page"] in seen
            or not isinstance(visual, VisualPage)
            or visual.reference != reference
            or not visual.matches_render()
        ):
            raise SemanticServiceError("SEMANTIC_VISUAL_REFERENCE_INVALID")
        seen.add(reference["page"])
        content.extend([
            {"type": "text", "text": f"Visual context: {canonical_bytes(reference).decode('utf-8')}"},
            {"type": "image_url", "image_url": {
                "url": "data:image/png;base64," + base64.b64encode(visual.png_bytes).decode("ascii")
            }},
        ])
    return [{"role": "user", "content": content}]


def _token_count(
    client: httpx.Client,
    service: dict[str, Any],
    messages: list[dict[str, Any]],
    chat_template_kwargs: dict[str, Any] | None = None,
) -> int:
    response = client.post(
        f"{service['base_url']}{TOKENIZE_PATH}",
        json={
            "model": service["model_id"],
            "messages": messages,
            "add_generation_prompt": True,
            "add_special_tokens": False,
            **({"chat_template_kwargs": chat_template_kwargs} if chat_template_kwargs is not None else {}),
        },
    )
    response.raise_for_status()
    body = response.json()
    if (
        not isinstance(body, dict)
        or type(body.get("count")) is not int
        or body["count"] < 1
        or body.get("max_model_len") != service["max_model_len"]
    ):
        raise SemanticServiceError("SEMANTIC_RESPONSE_INVALID")
    return body["count"]


def request_semantics(
    client: httpx.Client,
    *,
    runtime_lock: dict[str, Any],
    task: str,
    request: dict[str, Any],
    response_schema: dict[str, Any],
    visual_pages: tuple[VisualPage, ...] = (),
) -> dict[str, Any]:
    """所有產品語意共用同一 resident service 與同一 transport boundary。"""

    service = _service(runtime_lock)
    try:
        task_lock = runtime_lock["assessment" if task == "assessment_check" else task]
        prefix = "check_" if task == "assessment_check" else ""
        prompt = _material_prompt(task_lock) if task == "material_semantics" else task_lock[prefix + "prompt"]
        max_tokens = task_lock[prefix + "max_tokens"]
        if (
            task not in {"material_semantics", "assessment", "assessment_check"}
            or not isinstance(prompt, str)
            or not prompt
            or type(max_tokens) is not int
            or not 1 <= max_tokens < service["max_model_len"]
            or not isinstance(request, dict)
            or not isinstance(response_schema, dict)
        ):
            raise SemanticServiceError("SEMANTIC_SERVICE_CONFIG_INVALID")
        if (visual_pages or request.get("visual_pages")) and task != "material_semantics":
            raise SemanticServiceError("SEMANTIC_VISUAL_REFERENCE_INVALID")
        if len(visual_pages) > task_lock.get("max_visual_pages", 0):
            raise SemanticServiceError("SEMANTIC_VISUAL_REFERENCE_INVALID")
        messages = _messages(prompt, request, visual_pages)
        generation = deepcopy(task_lock[prefix + "generation"])
        margin = task_lock["context_margin_tokens"] if task == "material_semantics" else 0
        if _token_count(client, service, messages, generation.get("chat_template_kwargs")) + max_tokens + margin > service["max_model_len"]:
            raise SemanticServiceError("SEMANTIC_INPUT_TOO_LARGE")
        response = client.post(
            f"{service['base_url']}{CHAT_PATH}",
            json={
                **generation,
                "model": service["model_id"],
                "messages": messages,
                "max_tokens": max_tokens,
                **({"skip_special_tokens": False} if task == "material_semantics" else {}),
                "response_format": _material_response_format(response_schema) if task == "material_semantics" else {
                    "type": "json_schema",
                    "json_schema": {
                        "name": task,
                        "strict": True,
                        "schema": deepcopy(response_schema),
                    },
                },
            },
        )
        response.raise_for_status()
    except SemanticServiceError:
        raise
    except httpx.TimeoutException as error:
        raise SemanticServiceError("SEMANTIC_SERVICE_TIMEOUT") from error
    except (httpx.HTTPError, UnicodeError, ValueError) as error:
        raise SemanticServiceError("SEMANTIC_SERVICE_UNAVAILABLE") from error
    if not response.content or len(response.content) > MAX_RESPONSE_BYTES:
        raise SemanticServiceError("SEMANTIC_RESPONSE_INVALID")
    try:
        api_body = json.loads(
            response.content.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
        choice = api_body["choices"][0]
        if choice.get("finish_reason") != "stop":
            raise SemanticServiceError("SEMANTIC_OUTPUT_TRUNCATED")
        content = choice["message"]["content"]
        result = parse_material_final(content) if task == "material_semantics" else json.loads(
            content, object_pairs_hook=_unique_object, parse_constant=_reject_constant,
        )
    except SemanticServiceError:
        raise
    except (IndexError, KeyError, TypeError, UnicodeError, ValueError) as error:
        raise SemanticServiceError("SEMANTIC_RESPONSE_INVALID") from error
    if not isinstance(result, dict):
        raise SemanticServiceError("SEMANTIC_RESPONSE_INVALID")
    return result


def material_request_fits(
    client: httpx.Client, runtime_lock: dict[str, Any], request: dict[str, Any],
    *, visual_pages: tuple[VisualPage, ...] = (),
) -> bool:
    """使用 resident tokenizer 與正式推論相同的 prompt 和輸出預算。"""

    service = _service(runtime_lock)
    task = runtime_lock["material_semantics"]
    prompt = _material_prompt(task)
    if len(request.get("visual_pages", [])) > task["max_visual_pages"]:
        return False
    try:
        count = _token_count(client, service, _messages(prompt, request, visual_pages), task["generation"]["chat_template_kwargs"])
        if count + task["max_tokens"] + task["context_margin_tokens"] > service["max_model_len"]:
            return False
        # 原始 block 不截斷；多個 block 分批，避免新教材擠爆固定輸出預算。
        if sum(len(section["evidence"]) for section in request["sections"]) == 1:
            return True
        new_count = count
        if request.get("existing_concepts") or visual_pages:
            # Fresh Evidence has a textual budget; images still consume the full
            # request context above. Never count base64 characters as text tokens.
            fresh_request = {key: value for key, value in request.items() if key not in {"visual_pages", "material_id"}}
            fresh_request["existing_concepts"] = []
            new_count = _token_count(client, service, _messages(prompt, fresh_request), task["generation"]["chat_template_kwargs"])
    except httpx.TimeoutException as error:
        raise SemanticServiceError("SEMANTIC_SERVICE_TIMEOUT") from error
    except (httpx.HTTPError, UnicodeError, ValueError) as error:
        raise SemanticServiceError("SEMANTIC_SERVICE_UNAVAILABLE") from error
    return new_count <= task["max_new_input_tokens"]
