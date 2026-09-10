# Material semantic input qualification

Status: **qualification resumed under explicit user instruction**. The original successful fixed-pair request has now been reproduced through the production HTTP execution function with an identical complete final answer. The staged full-material candidate completed and improved reviewed Relation precision, with mixed Concept coverage; historical failures remain reported below. See [the protocol audit and reproduction](material-semantics-protocol-audit.md).

## Scope and reproducibility

Branch: `be/feature-multimodal-material-semantics`. Accepted base: `origin/dev` at `4e44a010e8947b1211312ba3cd0d1f52c9a7de5b`. No merge or push.

The user-selected PDF has 45 pages and SHA-256 `07b1c1c1352934f75cc5182aa15db8a702138861f7557f470f9200ac33b06d13`. Private source material, model answers, page renders, benchmark labels and detailed source reviews remain outside tracked files. This report contains aggregate measurements and implementation findings only.

Full runs call the actual `analyze_material` production path with real native extraction, real UnlimitedOCR, resident Qwen, Concept/Claim/Relation formation, deterministic validation and projection. Fixed benchmark endpoints are never supplied to full runs. Historical full runs and the first staged run performed OCR again. The two staged repair runs explicitly reuse successful real OCR responses and draft answers only after matching source/render and request hashes. They execute the production pipeline and new relation calls, but are not fresh end-to-end inference runs; new versus reused calls are reported separately.

The semantic server uses one A40, Qwen/Qwen3.8-27B-FP8 revision `017b9c7af6b5689d5dd426a76e0bc077eb5ca20a`, 32,768 context tokens, one sequence, and GPU memory utilization 0.90. Readback verified Python 3.12.3, vLLM 0.28.0, Torch 2.13.0+cu130 and Transformers 5.15.1. OCR executes on the existing local RTX 5060 Ti sidecar. The qualification SSH relay reaches the same resident HTTP endpoints; it starts no model server.

## Implemented behavior

Native text remains primary. OCR and visual context have independent decisions. Unreadable native text or substantive raster regions without sufficient native text coverage trigger OCR. Images below 1% of page area and isolated outer-margin images are excluded from that raster fallback signal. This is a conservative geometry heuristic, not a reliable classifier of image contents.

Visual candidates arise from explicit spatial/diagram cues associated with imagery, at least three nearby substantive native graphic strokes and labels, or figure/table geometry from an already-required OCR response. Backgrounds, accent bars and raster borders are excluded from the native-stroke count. Generic code variable names such as row/column were removed from the visual cue vocabulary after observed false positives.

Within each contiguous textual bundle, select up to three candidate pages by graphical area, breaking ties by page number and sending them in page order. The tokenizer can reduce image count from three to two to one before the text bundle is shortened. Visual context must remain local to the bundle. The code never drops all images solely to make a visually required request fit.

The same content-part messages go to the resident `/tokenize` and `/v1/chat/completions` endpoints. The full measured input, reserved output and 1,024-token margin must fit 32K. The existing fresh-input cap includes the task prompt but excludes the previous Concept catalog; it is not an exact count of fresh Evidence alone. An indivisible Evidence unit can exceed the fresh cap only after the full context check passes.

Page images live in a private temporary directory spanning extraction and semantics and are removed on success or failure. Image bytes are hidden from object representations. Material/page identity, render hash, local Evidence membership, PNG payload hash and image count are validated. Private graph provenance records selected page references and bundle Evidence IDs. Public views do not expose image payloads.

The material protocol allows native preparation before a strict-schema final JSON region. The client discards the preparation and parses only the final JSON. Assessment retains its existing protocol. Literal authority, canonical Relation taxonomy, endpoint validity, conflicts and cycles remain deterministic and unchanged. These checks cannot prove semantic support from a citation or correct OCR against the original page.

## Completed full-material measurements

Early hard-JSON runs constrained generation from its first output token and did not demonstrate native Low reasoning. They are retained as diagnostics, not relabeled as equivalent to later native-thinking candidates. Prompt wording, bundle packing and visual selection changed between diagnostic versions; those comparisons do not isolate causality.

| Configuration | Concepts / Claims / Relations | Semantic calls | OCR calls | Image inputs | Input / output tokens | Wall seconds | Truncations |
|---|---:|---:|---:|---:|---:|---:|---:|
| Accepted baseline: xhigh, 1536 / 4096, hard JSON | 60 / 84 / 72 | 20 | 33 | 0 | 170081 / 19282 | 1918.4 | 1 |
| Initial Low text, 8192 / 8192, hard JSON | 33 / 38 / 26 | 2 | 33 | 0 | 19277 / 7098 | 856.4 | 0 |
| Initial Low visual, image-driven bundle splits, hard JSON | 37 / 62 / 36 | 10 | 33 | 25 | 183143 / 9649 | 1276.8 | 0 |
| Low text, explicit Relation roles, hard JSON | 28 / 34 / 17 | 2 | 33 | 0 | 17272 / 5008 | 710.0 | 0 |
| Low visual, area selection, explicit roles, hard JSON | 32 / 60 / 21 | 5 | 33 | 12 | 103610 / 5921 | 936.9 | 0 |
| Low text, native thinking, 8192 / 8192 | No completed graph | 2 | 33 | 0 | 16252 / 16384 | 1522.2 | 2 |

The baseline completed 19 bundles and retried one truncated call. Other completed rows had no retries. The native-thinking failure retried the first bundle once; neither attempt completed. Its subsequent isolated output-budget probe reused the exact 8,126-token first-bundle input and increased only output reserve to 12,288. It also truncated (927.2 seconds), after reaching the final-answer region. This probe is not a completed full-material run.

## Baseline source review

All 72 baseline Relations were reviewed against endpoint scope, type, direction, reason, cited Evidence and relevant source context. The assistant review found 34 supported, 35 unsupported and three uncertain: conservative reviewed precision **47.2%**. Of the 34 supported edges, 31 had complete support in their own textual citations; three needed endpoint/source context. Error categories overlap: 29 wrong-type edges, 11 wrong-direction edges, one composition/prerequisite confusion and one corrupted technical literal in a Relation reason. Legal Evidence IDs were not counted as proof of semantic grounding.

A source-derived inventory of 36 teaching units found 30 with distinct endpoints and sufficient content, two with partial distinct coverage, and four retained only as Claims under broader or different endpoints. The inventory was never used as model input or a node quota. Seven heading/topic-only nodes and multiple overlapping declaration/example/implementation groups inflate the 60-node count. Partial coverage concerns table initialization/composition and sorting purpose/order. Claim-only coverage concerns uninitialized values, in-place mutation and separate input/output functions. Source-code preservation counts toward procedure coverage but does not imply a good learner explanation.

The initial Low variants reduce fragmentation but lose some basic access/input procedures and retain invalid Relation types. The initial visual packer split a program across page boundaries. The later visual candidate still exhibited endpoint-role and grounding problems. These findings eliminated those configurations before selecting production defaults.

## Deterministic and runtime validation

The current routing policy replayed against all 45 pages and cached real baseline OCR responses preserves all 411 textual Evidence units exactly. OCR is still required on 33 pages for this raster-heavy PDF. Twenty pages qualify as visual candidates; only a bounded subset per bundle is sent.

The final regression run passed **181 tests** (8.97 seconds after the final progress correction) across backend and local-AI suites. An initial sandbox run passed 148 but could not start 24 disposable-PostgreSQL fixtures; rerunning with Docker access passed all 172. One existing Starlette/httpx deprecation warning remains.

All twelve fixed-benchmark requests passed resident-tokenizer preflight: baseline input 14,812–14,869 tokens, native Low text 14,997–15,054, native Low with three images 21,174–21,231. Output reserves are respectively 4,096 and 8,192, plus the 1,024 margin. This is budget verification only, not benchmark accuracy. Fixed images retain the existing 144 DPI; production uses 200 DPI.


## Production protocol reproduction and fixed-pair evidence

The unchanged original `012 low-01` body ran through `_execute_semantic_request`, the same production executor used by `request_semantics`, against the resident server. Its complete final JSON equals the historical answer, including every reason and citation. The tokenizer and actual prompt usage both returned 21,136; output was 5,184; finish was `stop`; one generation took 420.630 seconds with no retry. P/N remained 11/12 and P/N/I 11/14. This establishes production protocol reproduction for 15 cases, not a new 60-case round or full-material success.

| Historical 012 condition, all with 3 selected images per call | P/N | P/N/I | Positive exact | Type-correct but wrong/missing direction | Insufficient exact | Complete batches | Input / output | Seconds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| xhigh, shared output 8192 | 0/42* | 0/52* | 0/33* | N/A: no complete answers | 0/10* | 0/4 | 84524 / 32768 | 2632.866 |
| Low, shared output 8192 | 38/42 | 39/52 | 29/33 | 1 | 1/10 | 4/4 | 84476 / 23018 | 1883.154 |
| Thinking off, output 8192 | 28/42 | 29/52 | 19/33 | 4 | 1/10 | 4/4 | 84364 / 4261 | 406.215 |

\* Truncated batches receive no partial credit in the fixed denominator; these zeros are not semantic accuracy among usable answers. Historical requests used pages 16/19/29 at 144 DPI, 12 image inputs over four calls per condition. The original requests, answers and grader remain unchanged. Repeated replay does not increase independent sample size.

No new controlled 60-case baseline / Low-text / Low-visual accuracy comparison was completed on this branch. Twelve candidate requests received tokenizer preflight only. Full-material failures eliminated native Low joint extraction before further fixed-pair expenditure; the historical three conditions above do not substitute for that missing comparison, nor isolate the effect of images. The real baseline and text/visual full-material trials are listed separately.

## Staged production candidate

Full-material generation now first forms Concepts, Claims and candidate relations with thinking disabled. Only production-generated, validated endpoint pairs enter a separate Low judgment call on the same resident Qwen; the judge does not receive the draft type, direction, reason or confidence. It can decline a relation while retaining both Concepts. The existing source, endpoint, ownership, conflict, cycle and literal guards still control final projection.

| Setting | Accepted baseline | Staged candidate |
|---|---|---|
| Service | Qwen3.8-27B-FP8, 32768 context, 1 sequence | Same resident service, model and revision |
| Concept/Claim generation | xhigh; first-token hard JSON | Thinking off; direct strict final JSON |
| Relation formalization | Joint with Concept extraction | Separate Low classification of generated pairs |
| Fresh input target | 1536 | 8192 for extraction; fixed-pair judgment uses complete relevant context within the total budget |
| Output reserve | 4096 | 8192 shared reasoning/final tokens per call |
| Margin | Existing baseline contract | 1024, checked using actual multimodal tokenizer |
| Images | None | At most 3, reduced to 2 or 1 to preserve complete text context |
| Seed | Not fixed in full baseline | 17001 for both stages |
| Automatic attempts | 2 | 1; failures do not publish a partial graph |
| Judgment batch | None | 4 pairs after measured 15- and 8-pair capacity failures |

Judgment prefers the whole eligible document; if that exceeds 32K, it tries complete pages containing endpoint Claim sources. Images remain local to those sources. The complete 45-page extraction still runs before judgment. Neither benchmark endpoints nor review inventory are model input. This candidate only judges draft-proposed pairs; it cannot recover missing Concepts or pairs never proposed by extraction.

The first staged run performed real OCR on 33 pages and two real draft calls (21,148/3,193 and 22,141/1,785 input/output). It formed 35 Concepts and 42 Claims; 21 raw draft relations became 17 unique valid pairs after existing validation and pair deduplication. The first review call returned an invalid direction combination, so no graph was published. Fixing the task-specific prompt and schema made the subsequent 15-pair call reach the final region, but it truncated at 8192. An 8-pair run completed its first batch (6236 output) and truncated its second (8192); it also published no graph.

| Staged attempt | New generations | Reused drafts / OCR | New input / output | Seconds | Result |
|---|---:|---:|---:|---:|---|
| Initial 15-pair implementation | 3 | 0 / 0 (33 new OCR) | 63489 / 12879 | 1354.164 | Invalid direction; no graph |
| Repaired 15-pair schema/prompt | 1 | 2 / 33 | 20247 / 8192 | 630.922 | Truncated; no graph |
| Repaired 8-pair batches | 2 | 2 / 33 | 38902 / 14428 | 1118.359 | Second batch truncated; no graph |
| Final 4/4/4/4/1 batches | 5 | 2 / 33 | 111950 / 15749 | 1301.442 | Complete graph; zero truncations/retries |

Cache reuse is explicit and private to qualification. The production pipeline still performs native extraction, rendering, normalization, Claim validation, judgment and final graph building. Cached OCR requires the same source-page/render identity; cached draft generation requires the identical complete HTTP request hash. A mismatch aborts rather than silently executing a different draft. No failed review answer is reused as successful output.



## Final 45-page production-path result

The full pipeline produced **35 Concepts, 42 Claims and 12 Relations** from all 45 pages, without fixed benchmark endpoints. All 17 generated pairs were judged exactly once in the completed candidate. The graph retained 12 supported model decisions and omitted five abstentions; the eight recorded rejected proposals comprise three original draft validation rejections and five judgment abstentions. One duplicate draft pair was deduplicated separately. These counts are model/validator decisions, not the manual quality verdicts below.

| Source-reviewed outcome | Accepted baseline | Final staged candidate |
|---|---:|---:|
| Concepts / Claims | 60 / 84 | 35 / 42 |
| Complete distinct teaching units, out of the same 36 | 30 | 29 |
| Partial distinct / Claim-only / absent units | 2 / 4 / 0 | 1 / 6 / 0 |
| Heading/topic-only nodes | 7 | 1 |
| Final Relations | 72 | 12 |
| Supported / unsupported / uncertain Relations | 34 / 35 / 3 | 10 / 1 / 1 |
| Conservative reviewed precision | 47.2% | **83.3%** |
| Supported edges with complete own textual citations | 31 | 10 |
| Wrong type / wrong direction | 29 / 11 | 1 / 0 |
| Composition/prerequisite confusion | 1 | 0 |
| Reviewed technical-literal errors in Relation reasons | 1 | 0 |

All final edges were reviewed against actual endpoint Claims, type, direction, reason, citations and source context. The remaining wrong type treats a general algorithm category member as a concrete example. The uncertain edge points a declaration concept at a broader table-correspondence endpoint while its reason describes a particular initializer; the same ambiguity was uncertain in baseline review. The initializer is visible in the source image, but not fully represented in that edge's textual citations. No endpoint or answer was repaired to award credit.

Concept formation improved in reduced duplicate fragments and distinct mutation/sorting-purpose coverage. It regressed in distinct matrix-operation, string-initialization and memory-layout endpoints, whose content remains under broader Concepts. Uninitialized values and separate input/output functions are still Claim-only. The source-derived inventory was never used as a node quota or model input. Fewer nodes does not itself establish better granularity, and Claim-only coverage does not equal a missing source fact.

The precision improvement is real for these reviewed outputs, but supported edge count fell from 34 to 10. This is not a recall improvement: the judge can only assess pairs proposed by the draft, and five abstentions may omit useful relationships. The absence of composition/prerequisite errors among the 12 surviving edges does not establish recovery of missing composition endpoints. The branch improves conservative Relation precision and reduces fragments, with explicit coverage and runtime tradeoffs; it does not establish across-the-board Concept improvement or an isolated causal benefit from images/Low.

| Runtime/lineage check | Final result |
|---|---|
| Pipeline calls | 2 draft + 5 Low judgments; 7 logical calls |
| New inference in final run | 5 judgments; 2 successful drafts reused by exact request hash |
| OCR | 33 prior real sidecar responses reused by render/request identity; 0 new OCR in final run |
| Logical input / output tokens | 155239 / 20727, including the two previously paid draft calls |
| Newly generated input / output tokens | 111950 / 15749 |
| Final run wall time | 1301.442 seconds; includes replay overhead, not fresh OCR/draft latency |
| Images | 14 input occurrences over 7 calls; 8 unique selected pages; at most 3 per request |
| Review output tokens per batch | 1188, 1946, 3508, 7330, 1777; all finish `stop` |
| Retries / truncations / observed OOM / engine death | 0 / 0 / 0 / 0 in completed candidate |
| Actual input budget | All 7 tokenizer counts match usage; every input + output reserve + 1024 fits 32768 |
| Textual Evidence | 411 units; all 238 Claim source quotes exactly match authoritative Evidence |
| Relation citations | All 60 reference occurrences valid; semantic support reviewed separately |
| Visual provenance | All 14 material/page/render references validated against fresh source renders |
| Literal repair | 36 source-bound Claim repairs; authority unchanged |

The fourth four-pair batch consumed 7330 of the shared 8192 output reserve. This is a successful qualification execution with limited output headroom, not evidence that any four pairs always finish. Invalid/truncated judgment still fails the material analysis instead of publishing its draft graph. A final progress correction ensures the semantic stage reports completion only after every judgment; it changes no model request, and the complete 181-test suite passed afterward.

At the observed A40 rate of US$0.49/h, the final run's measured wall time corresponds to about **US$0.177**, excluding the earlier paid OCR/draft stages. Across all new branch experiments, including failures and the exact reproduction, the ledger contains **57 generations, 803833 input tokens, 140445 output tokens, 264 real OCR calls, 7 truncations and 2 automatic retries** (both retries occurred in earlier configurations). Recorded wall time is approximately **13911 seconds / US$1.89**. This is an occupied-Pod-time estimate, not a provider bill; startup, review/idle time and two probes without retained latency are additional. Cached calls are not billed twice in this ledger. The final server readback matched the ledger exactly: 803833 prompt tokens, 140445 generated tokens, 50 stop and 7 length completions, zero abort/error, and zero running/waiting requests. The same engine PID remained alive. The Pod remains running.

## Decision boundaries

Native-first and the existing UnlimitedOCR sidecar remain justified: the revised routing preserves the real 411-unit textual artifact, and 33 pages of this PDF still require OCR. The branch separates that need from graphical interpretation; it does not promise to classify every decorative or meaningful image correctly.

At most three relevant page images is a bounded operating choice, with two or one selected when actual multimodal token counts require it. The experiments do not establish that three is globally optimal, or isolate an image-only causal gain. Full-context fixed-pair judgment and 8K fresh extraction are different workloads and have different packing rules.

Low does not reliably outperform xhigh across the entire material task: the original fixed-pair result is strong and reproduced exactly, while native Low joint extraction repeatedly exhausted its tested cap. The staged candidate therefore uses off for extraction and Low for bounded judgment, with 8192 output and the unchanged 32K service ceiling. Neither a complete final JSON nor valid Evidence IDs proves semantic correctness.

Remaining errors span extraction (OCR omissions/control-flow corruption), Concept formation (coarse or heading-only endpoints), and formalization/grounding (subtype versus example and claims that exceed endpoint scope). Source-code/diagram inconsistencies can originate in the PDF itself. One document, different task packing and one execution per candidate cannot separate model stochastic behavior from all prompt/context effects.

## Known limitations

One document and one stochastic run per configuration cannot establish universal quality or a reliable Low-versus-xhigh causal effect. Manual review is not independent teacher certification. Full graph precision and fixed-endpoint accuracy answer different questions.

OCR can change code structure even when literal projection faithfully preserves the resulting Evidence. A verified example absorbed a standalone control-flow statement into a comment. Another apparent algorithm inconsistency was present in the original PDF code and diagram, rather than caused by OCR. Relation reasons do not receive the same source-literal repair as Claims. Geometry alone can include irrelevant diagrams or miss visually important pages.

The staged settings are retained as the branch candidate based on the completed source review. They are not a universal quality guarantee. Native Low joint extraction failed within the tested budget; an identical fixed-endpoint Low request succeeded in production. These observations motivated separate draft extraction and bounded Low relation judgment using the same service. They do not establish a universal Low advantage.

## Branch handoff

- Branch: `be/feature-multimodal-material-semantics`.
- Accepted `origin/dev` base: `4e44a010e8947b1211312ba3cd0d1f52c9a7de5b`.
- Tested implementation commit: `ab667a95320dfab060ae6878220f93008126ee72`. The following documentation-only commit records this handoff.
- Production files changed from base: `backend/src/pdf_evidence/ocr_page_evidence.py`, `backend/src/pdf_evidence/visual_context.py`, `backend/src/pdf_evidence/material_pipeline.py`, `backend/src/runtime/semantic_service.py`, `backend/src/knowledge_map/structure.py`, and `local_ai/runtime-lock.json`.
- Final checks: `PYTHONPATH=backend/src:backend/tests:local_ai/src python -m pytest backend/tests local_ai/tests -q` using the project Python environment: 181 passed, one existing warning. `git diff --check` passed.
- No merge, push, direct dev edits or follow-up branch. Private source, graphs, OCR, renders, model answers, benchmark data and detailed reviews remain untracked. No secrets or private teaching material are included in the commits. The original 50 protected benchmark files retain their content hashes.

Implementation commits, oldest first:

| Commit | Purpose |
|---|---|
| `ed9b72ff` | Separate routing and selected visual transport |
| `51b8a44e` | Clarify canonical Relation roles |
| `f89f8dd2` | Preserve teaching context during image selection |
| `6bcb7cf5` | Native preparation before constrained final JSON |
| `b92fd7a2` | Retain procedures taught through worked examples |
| `92db9e68` | Exclude generic code identifiers from visual cues |
| `939aa50d` | Preserve complete text within multimodal budgets |
| `a42875ca` | Share the production HTTP executor for faithful replay |
| `ab667a95` | Bounded Low judgment of production-generated pairs and final progress correction |

The final production inference run predates only the progress-callback correction within the last implementation commit. Its model requests, runtime settings, parser, validators and graph projection are unchanged by that correction; final regression verification covers the committed code. The result is a qualified branch candidate with the measured tradeoffs above, not a deployment or a claim that every original experimental comparison was completed.
