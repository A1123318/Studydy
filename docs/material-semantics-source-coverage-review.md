# Source-grounded relationship coverage audit

This follow-up supersedes any interpretation of 83.3% Relation precision as overall graph quality or readiness. It does not modify production code, prompts, model answers, historical labels or the graph.

## Method and scope

The reviewer directly inspected the original 45-page PDF through page renders, including its diagrams and code, and used original native text where available. Production OCR was not treated as the authoritative source. The source SHA-256 remains `07b1c1c1352934f75cc5182aa15db8a702138861f7557f470f9200ac33b06d13`.

A new manual reference lists 48 source-supported core relationships. Every entry records endpoint meanings, type, direction, original page numbers and a source rationale. The original fixed 60-case benchmark and baseline graph are not the gold denominator. The reviewer is the same assistant and had already seen the candidate: this is not a blinded or independent teacher evaluation, nor proof of the unique or exhaustive true graph.

The scope covers learner-worthy definitions, structures and procedures. It excludes mere chapter proximity, generic similarity and transitive-only dependencies. A worked example can remain in the parent Concept's Claims; a separate node and example edge for every code instance is not required. Consequently this core reference does not impose a quota of example edges. Equivalent wording may match; a declaration cannot stand in for a physical component, and a comparison-topic node cannot stand in for the entities being compared. Where more than one type/direction is defensible for the same pair, alternatives are recorded explicitly and at most one reference hit is awarded.

The reference, 12 candidate-edge adjudications, page-render sheets, matching table and arithmetic are retained in the private qualification directory `source-grounded-review`. They are evaluation annotations, never model inputs or production rules. The source reference file contains no candidate outcomes; the separate comparison file records matches and omissions. This ordering does not imply that the reviewer had never seen the candidate.

## Results

| Measure | Current graph |
|---|---:|
| Core source relationships in this reference | 48 |
| Produced relationships | 12 |
| Correctly recovered reference relationships (TP) | 10 |
| Unsupported / uncertain, not awarded credit | 1 / 1 |
| Missing reference relationships (FN) | 38 |
| Precision: TP / produced | 10/12 = 83.3% |
| Recall on reference: TP / reference | 10/48 = 20.8% |
| F1: 2TP / (2TP + FP + FN) | 20/60 = 33.3% |
| Positive edge-set overlap (Jaccard) | 10/50 = 20.0% |

No true-negative universe was defined, so ordinary classification accuracy `(TP+TN)/all` is not reported. Calling F1 or Jaccard an exact universal accuracy would also be misleading. These are measurements against this explicit, inspectable manual reference. Uncertain output receives no credit in the conservative point estimate.

| Reference relation family | Reference count | Recovered |
|---|---:|---:|
| Necessary dependency | 20 | 5 |
| Concrete application | 20 | 4 |
| Explicit contrast | 5 | 1 |
| Actual composition | 3 | 0 |

The absence of a composition/prerequisite error in the 12 surviving edges does not show success on composition: none of the three core composition relationships was recovered. The graph misses both links between already present Concepts and links whose endpoints were merged into broader Concepts or retained only as Claims. The private row-by-row table distinguishes the required source meaning from the published endpoint meaning; existing Claim content is not silently promoted into a new endpoint for scoring.

## Interpretation

The graph is selective but incomplete. Its 83.3% precision describes the edges it emitted, while 20.8% reference recall exposes the large omission problem. F1 is 33.3% when both incorrect/uncertain edges and missing core edges are counted. This does not support calling the full-material graph qualified on completeness or claiming an overall improvement over baseline.

The earlier baseline figure 47.2% is a precision-only review over 72 different emitted edges. A baseline F1 has not been computed against this new 48-relationship reference, so 47.2% must not be compared directly with the current 33.3% F1. Concept coverage figures from the earlier report likewise describe endpoint coverage, not source-literal accuracy or this relationship F1.

No new Qwen generation, OCR inference, runtime change or production rule was introduced for this audit. The original graph remains at revision `knowledge-structure:sha256:da18f85a6c75ba37d6056de74f789d55d9b524f9df028089c710aacd59138767`.
