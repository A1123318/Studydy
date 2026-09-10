"""Export this experiment's aggregate evidence; never copy private payloads.

Usage: python export_evidence.py PRIVATE_QUALIFICATION_ROOT OUTPUT_DIRECTORY
No network, model execution, original-artifact mutation or credential access.
"""
import argparse
import hashlib
import json
from pathlib import Path


def read(path):
    return json.loads(path.read_text())


def pick(value, keys):
    return {key: value[key] for key in keys.split() if key in value}


def export(root, output):
    output.mkdir(parents=True, exist_ok=True)
    sources = {}

    def load(relative):
        path = root / relative
        sources[relative] = hashlib.sha256(path.read_bytes()).hexdigest()
        return read(path)

    def write(name, value):
        (output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")

    ledger = load("final-executed-run-ledger.json")
    extras = load("two-extra-materials/summary.json")
    run_keys = "run status wall_seconds wall_seconds_approx semantic_wall_seconds_approx semantic_calls ocr_calls input_tokens output_tokens truncations retries replayed_draft_calls replayed_ocr_calls reason_code"
    runs = [pick(row, run_keys) for row in ledger["model_runs"]]
    for row in extras["runs"]:
        runs.append(pick({**row, "run": "two-extra-materials/" + row["name"]}, run_keys))
    totals = {key: sum(row.get(key, 0) for row in runs) for key in
              "semantic_calls ocr_calls input_tokens output_tokens truncations retries".split()}
    wall = sum(row.get("wall_seconds") or row.get("wall_seconds_approx") or 0 for row in runs)
    write("runs.json", {"runs": runs, "totals": totals,
          "recorded_wall_seconds_sum": wall,
          "a40_rate_usd_per_hour_observed": 0.49,
          "recorded_wall_cost_estimate_usd": wall / 3600 * 0.49,
          "cost_limit": "Not an invoice; excludes startup/idle and two probes without retained timing. Cached stages counted only when first executed."})

    datasets = [{"id": "A", "pages": 45, "topic": "Programming: arrays and strings",
                 "source_sha256": "07b1c1c1352934f75cc5182aa15db8a702138861f7557f470f9200ac33b06d13"}]
    for alias, row, pages, topic in zip(["B", "C"], load("two-extra-materials/selection.json"),
                                      [26, 37], ["Data structures", "Performance appraisal"]):
        datasets.append({"id": alias, "pages": pages, "topic": topic, "source_sha256": row["source_sha256"]})
    write("datasets.json", datasets)

    event_keys = "path request_sha256 messages_sha256 visual_pages output_budget status tokenizer_count token_count count max_model_len thinking phase context_scope pair_count wall_seconds http_status cache_hit finish_reason final_region_present prefix_non_marker_characters final_json_valid"
    usage_keys = "prompt_tokens completion_tokens total_tokens"
    calls, tokenizations, settings, results = [], [], {}, {}
    for row in runs:
        name = row["run"]
        directory = root / name
        hp = directory / "http-metrics.json"
        if hp.exists():
            for index, event in enumerate(load(name + "/http-metrics.json")):
                target = calls if event["path"] == "/v1/chat/completions" else tokenizations if event["path"] == "/tokenize" else None
                if target is None:
                    continue
                entry = {"run": name, "source_event_index": index, **pick(event, event_keys)}
                entry["usage"] = pick(event.get("usage") or {}, usage_keys)
                entry.setdefault("cache_hit", False)
                target.append(entry)
        rp = directory / "result.json"
        if rp.exists():
            result = load(name + "/result.json")
            results[name] = pick(result, "condition status revision reason_code concepts claims relations engine_healthy_after wall_seconds semantic_calls ocr_calls new_model_calls replayed_draft_calls new_ocr_calls replayed_ocr_calls new_input_tokens new_output_tokens draft_calls relation_judgment_calls visual_page_inputs input_tokens output_tokens retries truncations")
            if "metrics" in result:
                results[name]["metrics"] = pick(result["metrics"], "semantic_calls ocr_calls evidence_duration_ms semantic_duration_ms literal_repairs rejected_claims rejected_relations")
        lp = directory / "runtime-lock.json"
        if lp.exists():
            lock = load(name + "/runtime-lock.json")
            settings[name] = {"material_semantics": lock["material_semantics"],
                              "semantic_service": pick(lock["semantic_service"], "model_id revision max_model_len max_num_seqs")}

    probe = load("probe-first-bundle-12k.json")
    calls.append({"run": "probe-first-bundle-12k", "cache_hit": False,
                  **pick(probe, "messages_sha256 input_tokens output_budget margin fits_32k finish_reason final_region_present prefix_non_marker_characters wall_seconds"),
                  "usage": pick(probe["usage"], usage_keys), "record_kind": "probe-summary-not-raw-HTTP"})
    replay = load("production-replay-low01/result.json")
    calls.append({"run": "production-replay-low01", "cache_hit": False,
                  **pick(replay, "original_body_sha256 messages_sha256 actual_input_tokens output_budget finish_reason wall_seconds"),
                  "usage": pick(replay["usage"], usage_keys), "record_kind": "production-replay-summary-not-raw-HTTP"})
    for name in ["public-preflight", "public-reasoning-preflight"]:
        for event in load(name + ".json")["http"]:
            if event.get("path") == "/v1/chat/completions":
                calls.append({"run": name, "cache_hit": False, **pick(event, event_keys),
                              "usage": pick(event["usage"], usage_keys), "record_kind": "public-probe-HTTP-metrics"})
    write("generation-calls.json", calls)
    write("tokenizer-events.json", tokenizations)
    write("runtime-settings.json", settings)
    write("full-run-results.json", results)

    reviews = {}
    review_keys = "ordinal relation_id status type source_pages own_textual_citations_complete wrong_type wrong_direction composition_prerequisite_confusion technical_literal_error"
    for path in sorted(root.rglob("relation-source-review.private.json")):
        relative = path.relative_to(root).as_posix()
        review = load(relative)
        reviews[path.parent.relative_to(root).as_posix()] = {
            "revision": review["revision"], "summary": review["summary"],
            "relations": [pick(item, review_keys) for item in review["relations"]]}
    write("relation-reviews.json", {"method": "Assistant source review, not independent teacher ground truth. Private endpoint labels, reasons and quotes are omitted; ordinal/hash/page and all verdict flags are retained.", "reviews": reviews})
    coverage = {}
    for path in sorted(root.rglob("concept-source-review.private.json")):
        review = load(path.relative_to(root).as_posix())
        coverage[path.parent.relative_to(root).as_posix()] = {
            "summary": review["summary"], "units": [
                {"ordinal": i, **pick(unit, "status pages"),
                 "concept_ordinals": [c["ordinal"] for c in unit["concepts"]]}
                for i, unit in enumerate(review["units"], 1)]}
    write("concept-coverage.json", coverage)
    core = load("source-grounded-review/comparison.private.json")
    write("source-core-review.json", {**pick(core, "candidate_revision candidate_file_sha256 counts metrics"),
          "reference_relations": [pick(x, "id type pages candidate_status") for x in core["reference_relations"]],
          "candidate_adjudication": [pick(x, "ordinal relation_id type status reference_id") for x in core["candidate_adjudication"]],
          "limit": "48 manually selected core positive relationships; same unblinded assistant, not an exhaustive or unique true graph. No true-negative accuracy or baseline F1 was established."})

    original = load("offline-protocol-audit.json")
    write("protocol-validation.json", {
        "historical_012": pick(original, "status original_inputs_modified summary original_request_manifest_matches original_download_manifest_matches all_hashes_match original_score_sha256 reference_sha256 current_grammar_equal_given_original_schema"),
        "live_15_pair_reproduction": pick(replay, "status model_calls tokenizer_calls retries original_files_modified original_body_sha256 messages_sha256 original_input_tokens actual_input_tokens output_budget seed source_module_sha256 finish_reason final_region_present reasoning_text_retained completed_pairs semantic_decisions_matching_original pn pni wall_seconds estimated_window_cost_usd entire_final_json_matches_original"),
        "offline_production_replays": load("production-replay-offline.json"),
        "schema_validation": pick(load("relation-schema-validation.json"), "xgrammar_version grammar_compiled model_calls accepted original_decisions_shape_valid original_decisions_checked original_grader_changed"),
        "schema_cpu_validation": load("relation-schema-cpu-validation.json"),
        "cached_stage_verification": load("staged-cache-verification/verification.json"),
        "original_file_integrity": load("audit-source-integrity.json"),
        "two_extra_tests_file_integrity": load("two-extra-materials/tracked-files-after.json")})
    write("runtime-validation.json", {"initial_and_staged": load("runtime-audit.json"),
          "additional_decks": load("two-extra-materials/runtime-audit.json"),
          "before_extra_tests": load("final-runtime-readback.json"),
          "after_extra_tests": load("two-extra-materials/engine-after.json")})
    write("source-record-hashes.json", sources)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("private_root", type=Path)
    parser.add_argument("output_directory", type=Path)
    args = parser.parse_args()
    export(args.private_root, args.output_directory)
