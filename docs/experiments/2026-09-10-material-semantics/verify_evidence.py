"""Verify the archived public measurements offline; no model or service needed."""
import hashlib
import json
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).parent


def load(name):
    return json.loads((ROOT / name).read_text())


def verify():
    manifest = load("manifest.json")
    actual_files = {p.name for p in ROOT.iterdir() if p.is_file() and p.name != "manifest.json"}
    assert actual_files == set(manifest["files"]), "Unlisted or missing public evidence file"
    for name, expected in manifest["files"].items():
        raw = (ROOT / name).read_bytes()
        assert len(raw) == expected["bytes"], name
        assert hashlib.sha256(raw).hexdigest() == expected["sha256"], name

    ledger = load("runs.json")
    fresh = [row for row in load("generation-calls.json") if not row["cache_hit"]]
    assert len(fresh) == ledger["totals"]["semantic_calls"] == 70
    assert sum(row["usage"]["prompt_tokens"] for row in fresh) == ledger["totals"]["input_tokens"] == 996341
    assert sum(row["usage"]["completion_tokens"] for row in fresh) == ledger["totals"]["output_tokens"] == 169785
    assert Counter(row["finish_reason"] for row in fresh) == {"stop": 63, "length": 7}
    for run in ledger["runs"]:
        calls = [row for row in fresh if row["run"] == run["run"]]
        assert len(calls) == run["semantic_calls"], run["run"]
        assert sum(row["usage"]["prompt_tokens"] for row in calls) == run["input_tokens"], run["run"]
        assert sum(row["usage"]["completion_tokens"] for row in calls) == run["output_tokens"], run["run"]

    for name, review in load("relation-reviews.json")["reviews"].items():
        counts = Counter(row["status"] for row in review["relations"])
        summary = review["summary"]
        for status in ["supported", "unsupported", "uncertain"]:
            assert counts[status] == summary[status], name
        assert len(review["relations"]) == summary["reviewed"], name
        assert abs(counts["supported"] / summary["reviewed"] - summary["reviewed_precision"]) < 1e-12, name

    core = load("source-core-review.json")
    counts = core["counts"]
    assert len(core["reference_relations"]) == counts["reference_core_relations"] == 48
    assert sum(row["candidate_status"] == "matched" for row in core["reference_relations"]) == counts["true_positive"] == 10
    assert counts["false_negative"] == 38 and counts["candidate_relations"] == 12
    assert abs(core["metrics"]["f1"] - 1 / 3) < 1e-12

    protocol = load("protocol-validation.json")
    assert protocol["live_15_pair_reproduction"]["entire_final_json_matches_original"]
    assert protocol["live_15_pair_reproduction"]["completed_pairs"] == 15
    assert protocol["two_extra_tests_file_integrity"]["all_unchanged"]
    runtime = load("runtime-validation.json")
    for row in runtime["initial_and_staged"]:
        assert row["tokenizer_matches_usage"] and row["all_requests_within_32k"]
    for row in runtime["additional_decks"]:
        assert row["runtime_lock_unchanged"] and row["all_inference_fresh"]
        assert row["tokenizer_matches_usage"] and row["within_32k"]
    metrics = runtime["after_extra_tests"]["metrics"]
    for metric, expected in [("prompt_tokens_total", 996341), ("generation_tokens_total", 169785),
                             ("num_requests_running", 0), ("num_requests_waiting", 0)]:
        line, = [line for line in metrics if line.startswith("vllm:" + metric + "{")]
        assert float(line.rsplit(" ", 1)[1]) == expected, metric
    print("PASS: file hashes, 70 fresh generations, token totals, per-run accounting, review arithmetic and reproduction records agree.")
    print("This verifies archive consistency, not independent semantic correctness.")


if __name__ == "__main__":
    verify()
