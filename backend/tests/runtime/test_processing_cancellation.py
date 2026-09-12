"""單一 run 的取消在真 PostgreSQL 中排序；不執行 OCR 或模型。"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, UTC
from threading import Event, local
from uuid import UUID, uuid4

import psycopg
from psycopg.types.json import Jsonb
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

import runtime.api.app as api_app
import runtime.material_processing as processing
from runtime.storage.tables import MaterialProcessingRun as RunRow
from runtime.storage.migrations import run_migrations
from runtime.storage.materials import read_material_library
from runtime.storage.knowledge_structures import publish_knowledge_structure, read_knowledge_structure
from runtime.learner_session import register_account
from learning_adaptation.study_sessions import create_study_session
from test_closed_loop_v1 import closed_loop, _settings, _structure

ORIGIN = "http://127.0.0.1:4173"

class SessionToken(str):
    def __repr__(self):
        return "<test session token>"


@pytest.fixture
def cancellation_run(closed_loop):
    learner, source, settings, structure, dsn, token = closed_loop
    run = processing.create_material_processing_run(learner.learner_id, source.material_id, source.artifact_id, "cancel-test", settings, dsn=dsn)
    return learner, source, settings, structure, dsn, SessionToken(token), run


def claim_stage(fixture, stage="evidence"):
    *_, dsn, _token, run = fixture
    claim = processing.claim_next_material_processing_run(dsn=dsn)
    assert claim.run.run_id == run.run_id
    for next_stage in ["evidence", "semantics", "publishing"]:
        if stage == "queued": break
        processing._record_progress(run.run_id, next_stage, 1, 1, dsn=dsn)
        if next_stage == stage: break
    return claim


def cancel(fixture):
    learner, _, _, _, dsn, _, run = fixture
    return processing.request_material_processing_cancellation(learner.learner_id, run.run_id, dsn=dsn)


def read(fixture):
    learner, _, _, _, dsn, _, run = fixture
    return processing.read_material_processing_run(learner.learner_id, run.run_id, dsn=dsn)


def test_pending_cancellation_is_immediate_and_idempotent(cancellation_run):
    result = cancel(cancellation_run)
    assert result.status == "cancelled" and result.progress_stage == "queued"
    assert result.completed_pages == 0 and result.total_pages is None
    assert result.cancel_requested_at == result.completed_at == result.updated_at
    assert result.output_binding is None and result.error_code is None
    assert cancel(cancellation_run) == result
    learner, source, settings, _, dsn, _, _ = cancellation_run
    assert processing.create_material_processing_run(learner.learner_id, source.material_id, source.artifact_id, "cancel-test", settings, dsn=dsn) == result
    assert processing.claim_next_material_processing_run(dsn=cancellation_run[4]) is None


@pytest.mark.parametrize("stage", ["queued", "evidence", "semantics"])
def test_running_cancellation_persists_intent_until_a_committed_checkpoint(cancellation_run, stage):
    claim_stage(cancellation_run, stage)
    before = read(cancellation_run)
    requested = cancel(cancellation_run)
    assert requested.status == "running" and requested.completed_at is None
    assert requested.cancel_requested_at is not None
    assert cancel(cancellation_run) == requested
    with pytest.raises(processing.MaterialProcessingCancelled):
        processing._record_progress(requested.run_id, "evidence", 1, 1, dsn=cancellation_run[4])
    stopped = read(cancellation_run)
    assert stopped.status == "cancelled" and stopped.error_code is None and stopped.output_binding is None
    assert stopped.cancel_requested_at == requested.cancel_requested_at
    assert (stopped.progress_stage, stopped.completed_pages, stopped.total_pages) == (before.progress_stage, before.completed_pages, before.total_pages)
    processing._record_failure(stopped.run_id, "UNEXPECTED", dsn=cancellation_run[4])
    assert read(cancellation_run) == stopped


def test_publishing_and_terminal_runs_are_unchanged(cancellation_run):
    claim_stage(cancellation_run, "publishing")
    before = read(cancellation_run)
    assert cancel(cancellation_run) == before and before.cancel_requested_at is None
    processing._record_failure(before.run_id, "EXPECTED_FAILURE", dsn=cancellation_run[4])
    failed = read(cancellation_run)
    assert cancel(cancellation_run) == failed and failed.cancel_requested_at is None
    learner, source, settings, original, dsn, _, _ = cancellation_run
    original_run = processing.read_material_processing_run(learner.learner_id, UUID(original["run_id"]), dsn=dsn)
    assert original_run.status == "succeeded"
    assert processing.request_material_processing_cancellation(learner.learner_id, original_run.run_id, dsn=dsn) == original_run
    partial = processing.create_material_processing_run(learner.learner_id, source.material_id, source.artifact_id, "partial", settings, dsn=dsn)
    processing.claim_next_material_processing_run(dsn=dsn)
    for stage in ["evidence", "semantics", "publishing"]: processing._record_progress(partial.run_id, stage, 1, 1, dsn=dsn)
    document = _structure(str(partial.run_id), source.sha256, settings["runtime_lock"], partial=True)
    publish_knowledge_structure(learner.learner_id, source.material_id, partial.run_id, document, dsn=dsn)
    saved = processing.read_material_processing_run(learner.learner_id, partial.run_id, dsn=dsn)
    assert saved.status == "partial"
    assert processing.request_material_processing_cancellation(learner.learner_id, partial.run_id, dsn=dsn) == saved


def test_owner_isolation(cancellation_run):
    with pytest.raises(processing.MaterialProcessingError, match="MATERIAL_RUN_NOT_FOUND"):
        processing.request_material_processing_cancellation(uuid4(), cancellation_run[-1].run_id, dsn=cancellation_run[4])
    assert read(cancellation_run).status == "pending"


def test_failure_and_restart_preserve_accepted_cancellation(cancellation_run):
    claim_stage(cancellation_run)
    cancel(cancellation_run)
    processing._record_failure(cancellation_run[-1].run_id, "WORKER_ERROR", dsn=cancellation_run[4])
    assert read(cancellation_run).status == "cancelled"
    learner, source, settings, _, dsn, _, _ = cancellation_run
    runs = []
    for key in ["requested-at-restart", "ordinary-at-restart"]:
        run = processing.create_material_processing_run(learner.learner_id, source.material_id, source.artifact_id, key, settings, dsn=dsn)
        processing.claim_next_material_processing_run(dsn=dsn); runs.append(run)
    processing.request_material_processing_cancellation(learner.learner_id, runs[0].run_id, dsn=dsn)
    assert processing.recover_interrupted_material_runs(dsn=dsn) == 2
    requested, ordinary = [processing.read_material_processing_run(learner.learner_id, run.run_id, dsn=dsn) for run in runs]
    assert requested.status == "cancelled" and requested.error_code is None
    assert ordinary.status == "failed" and ordinary.error_code == "RESTART_INTERRUPTED" and ordinary.cancel_requested_at is None
    assert processing.recover_interrupted_material_runs(dsn=dsn) == 0


@pytest.mark.parametrize("checkpoint", ["before-preflight", "after-preflight", "evidence", "semantics", "before-publishing", "analysis-failure"])
def test_worker_unwinds_cancel_without_failure_or_publishing_and_keeps_old_data(cancellation_run, monkeypatch, checkpoint):
    learner, source, settings, original, dsn, _, run = cancellation_run
    study = create_study_session(learner, source.material_id, original["revision"], "old-study", dsn=dsn)
    claim = claim_stage(cancellation_run, "queued")
    failures = []
    if checkpoint != "analysis-failure":
        monkeypatch.setattr(processing, "_record_failure", lambda *args, **kwargs: failures.append(args))
    if checkpoint == "before-preflight": cancel(cancellation_run)
    def preflight(_settings):
        assert checkpoint != "before-preflight"
        if checkpoint == "after-preflight": cancel(cancellation_run)
        return run.runtime_binding
    monkeypatch.setattr(processing, "runtime_preflight", preflight)
    def analyze(_request, _settings, *, progress_callback, cancellation_check, **_kwargs):
        assert checkpoint not in {"before-preflight", "after-preflight"}
        if checkpoint == "analysis-failure":
            cancel(cancellation_run)
            raise processing.MaterialAnalysisError("NO_USABLE_EVIDENCE")
        for stage in ["evidence", "semantics"]:
            if checkpoint == stage: cancel(cancellation_run)
            progress_callback(stage, 1, 1)
        if checkpoint == "before-publishing": cancel(cancellation_run)
        return _structure(str(run.run_id), source.sha256, settings["runtime_lock"])
    monkeypatch.setattr(processing, "analyze_material", analyze)
    result = processing.execute_claimed_material_processing_run(claim, settings, dsn=dsn)
    assert result.status == "cancelled" and result.error_code is None
    assert failures == []
    with psycopg.connect(dsn) as connection:
        assert connection.execute("SELECT count(*) FROM knowledge_structures WHERE run_id=%s", (run.run_id,)).fetchone() == (0,)
        assert connection.execute("SELECT count(*) FROM artifacts WHERE artifact_id=%s", (source.artifact_id,)).fetchone() == (1,)
        assert connection.execute("SELECT count(*) FROM study_sessions WHERE study_session_id=%s", (study.study_session_id,)).fetchone() == (1,)
    assert read_knowledge_structure(learner.learner_id, source.material_id, revision=original["revision"], dsn=dsn).document == original
    item = read_material_library(learner.learner_id, dsn=dsn)[0]
    assert item["latest_attempt"]["status"] == "cancelled" and item["latest_attempt"]["cancel_requested_at"] is not None
    assert item["available_structures"][0]["knowledge_structure_revision"] == original["revision"]


def ordered_race(monkeypatch, fixture, first, second):
    """先確定 winner 已持 row lock，再讓另一條 connection 進場，不用 sleep。"""
    original = processing.database_session
    held, contender, release = Event(), Event(), Event()
    identity = local()
    @contextmanager
    def gated(dsn):
        with original(dsn) as session:
            if identity.role == "first":
                session.scalar(select(RunRow).where(RunRow.run_id == fixture[-1].run_id).with_for_update())
                held.set(); assert release.wait(5)
            else: contender.set()
            yield session
    monkeypatch.setattr(processing, "database_session", gated)
    def invoke(role, action):
        identity.role = role
        try: return action()
        except processing.MaterialProcessingCancelled: return "checkpoint-cancelled"
    with ThreadPoolExecutor(max_workers=2) as executor:
        winner = executor.submit(invoke, "first", first); assert held.wait(5)
        loser = executor.submit(invoke, "second", second); assert contender.wait(5)
        release.set()
        results = winner.result(5), loser.result(5)
    monkeypatch.setattr(processing, "database_session", original)
    return results


@pytest.mark.parametrize("cancel_first", [True, False])
def test_claim_vs_cancel_row_lock_order(cancellation_run, monkeypatch, cancel_first):
    claim = lambda: processing.claim_next_material_processing_run(dsn=cancellation_run[4])
    request = lambda: cancel(cancellation_run)
    ordered_race(monkeypatch, cancellation_run, request if cancel_first else claim, claim if cancel_first else request)
    saved = read(cancellation_run)
    assert saved.status == ("cancelled" if cancel_first else "running")
    assert saved.cancel_requested_at is not None


@pytest.mark.parametrize("cancel_first", [True, False])
def test_publishing_vs_cancel_row_lock_order(cancellation_run, monkeypatch, cancel_first):
    claim_stage(cancellation_run, "semantics")
    publish = lambda: processing._record_progress(cancellation_run[-1].run_id, "publishing", 1, 1, dsn=cancellation_run[4])
    request = lambda: cancel(cancellation_run)
    ordered_race(monkeypatch, cancellation_run, request if cancel_first else publish, publish if cancel_first else request)
    saved = read(cancellation_run)
    assert saved.status == ("cancelled" if cancel_first else "running")
    assert (saved.cancel_requested_at is not None) == cancel_first
    assert saved.progress_stage == ("semantics" if cancel_first else "publishing")


def test_cancel_api_transport_and_openapi(cancellation_run, monkeypatch):
    monkeypatch.setattr(api_app, "runtime_preflight", lambda _: {})
    learner, _, settings, _, dsn, token, run = cancellation_run
    app = api_app.create_app(api_app.ApiSettings(profile="local", public_origin=ORIGIN, secure_cookie=False, local_config=settings, dsn=dsn))
    client = TestClient(app, base_url=ORIGIN)
    endpoint = f"/v1/material-processing-runs/{run.run_id}/cancel"
    assert client.post(endpoint, headers={"Origin": ORIGIN}).status_code == 401
    client.cookies.set("studydy_session", token)
    assert client.post(endpoint).status_code == 403
    assert client.post(endpoint, headers={"Origin": "http://wrong.invalid"}).status_code == 403
    for body in [b"{}", b"null", b" "]:
        assert client.post(endpoint, headers={"Origin": ORIGIN}, content=body).status_code == 400
    assert client.post(endpoint + "?x=1", headers={"Origin": ORIGIN}).status_code == 400
    assert client.post(endpoint, headers={"Origin": ORIGIN, "X-Learner-Id": str(learner.learner_id)}).status_code == 400
    result = client.post(endpoint, headers={"Origin": ORIGIN})
    assert result.status_code == 200 and result.json()["schema"] == "material-processing-run/v5"
    assert result.json()["status"] == "cancelled"
    assert client.post(endpoint, headers={"Origin": ORIGIN}).json() == result.json()
    foreign = register_account("foreign_cancel@example.com", "Synthetic test password 42", dsn=dsn)
    client.cookies.set("studydy_session", foreign.raw_token)
    assert client.post(endpoint, headers={"Origin": ORIGIN}).status_code == 404
    operation = app.openapi()["paths"]["/v1/material-processing-runs/{run_id}/cancel"]["post"]
    assert operation["security"] == [{"CookieSession": []}]
    assert any(parameter["name"] == "Origin" and parameter["required"] for parameter in operation["parameters"])
    assert not any(parameter["name"] == "Idempotency-Key" for parameter in operation["parameters"])
    assert "requestBody" not in operation


def test_migration_is_additive_and_constraints_reject_invalid_cancellation(clean_database_dsn, migrations_dir, tmp_path):
    old = tmp_path / "old-migrations"; old.mkdir()
    for source in migrations_dir.glob("*.sql"):
        if source.name.startswith("0005"): continue
        (old / source.name).write_bytes(source.read_bytes())
    assert run_migrations(clean_database_dsn, migrations_dir=old) == (1, 2, 3, 4)
    account = register_account("migration_cancel@example.com", "Synthetic test password 42", dsn=clean_database_dsn)
    # 原表以 SQL 建立舊 run，避免新版 mapping 在 migration 前讀取新欄位。
    with psycopg.connect(clean_database_dsn) as connection:
        names = {row[0] for row in connection.execute("SELECT conname FROM pg_constraint WHERE conrelid='material_processing_runs'::regclass AND contype='c'")}
        assert {"material_processing_runs_check", "material_processing_runs_status_check"} <= names
        connection.execute("SET CONSTRAINTS ALL DEFERRED")
        mid, aid, rid = uuid4(), uuid4(), uuid4(); now = datetime.now(UTC)
        connection.execute("INSERT INTO materials(material_id,learner_id,source_artifact_id,upload_idempotency_key_sha256,upload_request_fingerprint,created_at) VALUES (%s,%s,%s,%s,%s,%s)", (mid, account.learner_id, aid, bytes(32), bytes(32), now))
        connection.execute("INSERT INTO artifacts VALUES (%s,%s,%s,'source_pdf','application/pdf',%s,1,%s)", (aid, account.learner_id, mid, bytes(32), now))
        connection.execute("INSERT INTO material_processing_runs(run_id,learner_id,material_id,source_artifact_id,idempotency_key_sha256,request_fingerprint,runtime_binding,status,progress_stage,created_at,updated_at) VALUES (%s,%s,%s,%s,%s,%s,%s,'pending','queued',%s,%s)", (rid, account.learner_id, mid, aid, bytes(32), bytes(32), Jsonb(processing.runtime_binding(_settings(tmp_path))), now, now))
        before = connection.execute("SELECT row_to_json(r) FROM material_processing_runs r").fetchone()[0]
    assert run_migrations(clean_database_dsn, migrations_dir=migrations_dir) == (5,)
    assert run_migrations(clean_database_dsn, migrations_dir=migrations_dir) == ()
    with psycopg.connect(clean_database_dsn) as connection:
        after = connection.execute("SELECT row_to_json(r) FROM material_processing_runs r").fetchone()[0]
        assert after.pop("cancel_requested_at") is None and after == before
    for clause in [
        "status='cancelled',completed_at=now()", "status='cancelled',cancel_requested_at=now()",
        "status='running',progress_stage='publishing',cancel_requested_at=now()", "cancel_requested_at=now()",
        "status='failed',completed_at=now(),error_code='ERROR',cancel_requested_at=now()",
        "status='succeeded',progress_stage='completed',completed_at=now(),output_binding='{}',cancel_requested_at=now()",
    ]:
        with psycopg.connect(clean_database_dsn) as connection:
            with pytest.raises(psycopg.errors.CheckViolation): connection.execute("UPDATE material_processing_runs SET " + clause)

@pytest.mark.parametrize("cancel_first", [True, False])
def test_failure_vs_cancel_row_lock_order(cancellation_run, monkeypatch, cancel_first):
    claim_stage(cancellation_run)
    failure = lambda: processing._record_failure(cancellation_run[-1].run_id, "WORKER_ERROR", dsn=cancellation_run[4])
    request = lambda: cancel(cancellation_run)
    ordered_race(monkeypatch, cancellation_run, request if cancel_first else failure, failure if cancel_first else request)
    saved = read(cancellation_run)
    assert saved.status == ("cancelled" if cancel_first else "failed")
    assert saved.error_code == (None if cancel_first else "WORKER_ERROR")
