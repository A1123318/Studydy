# A40 final workstation

1. Check out the candidate feature branch without merging it. Confirm a clean tree and record `HEAD`.
2. Start the externally owned `Qwen/Qwen3.8-27B-FP8` vLLM service on `127.0.0.1:8000` with the
   runtime-lock versions, 32K context, one sequence, and bearer value supplied only through
   `STUDYDY_SEMANTIC_API_KEY`.
3. Export an absolute private `STUDYDY_LOCAL_RUNTIME_ROOT`; its OCR Python minor must be 3.12.
   Export `STUDYDY_ARTIFACT_ROOT` and database DSN only in the private shell. Never echo them.
4. Apply the migrations to a fresh database, or apply the pending additive migrations (credentials and
   material names) to the accepted schema. A second invocation must return an empty tuple. Before upgrading a database
   containing needed data, stop product writes and privately preserve the database and source PDF
   store together. Do not replace their configured locations. See [account setup](../accounts.md).
5. Run `runtime.local_runtime verify`, the complete local regression in `docs/testing.md`, and the A40
   `run` command on a representative 8-page input, the 45-page array material, another technical
   material, and a scanned material.
6. Through the real browser/API, verify upload, progress, Evidence, Concepts, Relations, Map, Path,
   StudySession, Assessment, answer, learner guidance, reload/reopen, exact revision, and PDF locator.
7. Complete the private review bound to the run SHA and run the `score` command. A summary with
   `"pass": true` is the only final A40 PASS evidence.
8. Stop only backend-owned processes and the explicit database. Do not stop the resident Qwen service.

Do not commit `.env`, private PDFs, review data, raw model output, `.studydy-runtime/`, `docs_local/`,
runtime/model paths, credentials, or DSNs.

## Semantic endpoint configuration

Local resident vLLM remains the canonical deployment. When `STUDYDY_SEMANTIC_BASE_URL` is unset,
the backend uses `http://127.0.0.1:8000`. Operators without sufficient local GPU capacity can set an
HTTPS origin, for example `https://semantic.example.com`. No cloud provider is a product dependency.
Use an origin only: no `/v1` suffix, path prefix, credentials, query, or fragment. HTTP is allowed
only for loopback (`127.0.0.1`, `localhost`, `::1`). Redirects and environment proxy settings are disabled.

Export `STUDYDY_SEMANTIC_API_KEY` in the backend/worker process environment; empty or unset sends no
Authorization header. The former `VLLM_API_KEY` client setting is no longer read. Configure the
externally owned server's matching token separately. `backend/.env.example` documents the fields;
the backend does not automatically load `.env`. Never commit or log real keys or `.env` files.
Restart the backend/workers after changing connection settings.

The remote service must expose `/health`, `/version`, `/v1/models`, `/tokenize`, and
`/v1/chat/completions` at that origin, accepting the same bearer token. Preflight still requires
vLLM `0.28.0`, exactly one served `Qwen/Qwen3.8-27B-FP8`, and `max_model_len=32768` in both model
and tokenizer responses. Chat must support the locked generation settings and JSON-schema output.
An OpenAI-compatible chat endpoint alone is insufficient; gateways hiding these routes or requiring
redirects will fail. The operator must deploy exact revision
`017b9c7af6b5689d5dd426a76e0bc077eb5ca20a`; these probes do not attest the model weights' revision.
Prompts, generation settings, Concept/Relation/Assessment behavior, and the local OCR runtime are unchanged.

Existing Maps validate their saved runtime binding and hashes, independently of today's endpoint or
key. New runs record the selected endpoint in the existing binding field; keys are never persisted.
No DB migration is needed. Endpoint changes do not rewrite old bindings or require inference to reopen a Map.
