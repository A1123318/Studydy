"""Unused Material discard authority; no deletion of published learning data."""
from uuid import UUID

from sqlalchemy import delete, func, select

from .material_processing import _request_cancellation_locked
from .storage.artifacts import quarantine_source_pdf, reconcile_discarded_sources
from .storage.tables import Artifact, KnowledgeStructure, Material, MaterialProcessingRun, StudySession, database_session


class MaterialDiscardError(RuntimeError):
    """Fixed reasons only; never expose database or filesystem details."""


def _locked_runs(session, material):
    return session.scalars(select(MaterialProcessingRun).where(
        MaterialProcessingRun.material_id == material.material_id,
    ).order_by(MaterialProcessingRun.run_id).with_for_update()).all()


def _require_discardable(session, material, runs):
    protected = any(row.status in {"succeeded", "partial"} or (row.status == "running" and row.progress_stage == "publishing") for row in runs)
    if protected or any(session.scalar(select(table.material_id).where(table.material_id == material.material_id).limit(1)) is not None for table in (KnowledgeStructure, StudySession)):
        raise MaterialDiscardError("MATERIAL_NOT_DISCARDABLE")


def request_material_discard(learner_id: UUID, material_id: UUID, *, dsn: str | None = None) -> str:
    try:
        with database_session(dsn) as session:
            material = session.scalar(select(Material).where(Material.material_id == material_id, Material.learner_id == learner_id).with_for_update())
            if material is None:
                raise MaterialDiscardError("RESOURCE_NOT_FOUND")
            runs = _locked_runs(session, material)
            _require_discardable(session, material, runs)
            if material.discard_requested_at is None:
                material.discard_requested_at = session.scalar(select(func.clock_timestamp()))
            for row in runs:
                _request_cancellation_locked(material, row, session)
        # Cancellation 的 transaction 必須先 commit；purge 再重新確認所有 runs。
        return "removed" if purge_discarded_material(learner_id, material_id, dsn=dsn) else "removing"
    except MaterialDiscardError:
        raise
    except Exception:
        raise MaterialDiscardError("MATERIAL_DISCARD_STORAGE_FAILED") from None


def purge_discarded_material(learner_id: UUID, material_id: UUID, *, dsn: str | None = None) -> bool:
    artifact_id = None
    try:
        with database_session(dsn) as session:
            material = session.scalar(select(Material).where(Material.material_id == material_id, Material.learner_id == learner_id).with_for_update())
            if material is None:
                return True
            if material.discard_requested_at is None:
                return False
            runs = _locked_runs(session, material)
            _require_discardable(session, material, runs)
            if any(row.status in {"pending", "running"} for row in runs):
                return False
            artifact = session.scalar(select(Artifact).where(
                Artifact.artifact_id == material.source_artifact_id, Artifact.material_id == material_id,
                Artifact.learner_id == learner_id, Artifact.kind == "source_pdf",
            ).with_for_update())
            if artifact is None:
                raise MaterialDiscardError("MATERIAL_DISCARD_STORAGE_FAILED")
            artifact_id = artifact.artifact_id
            quarantine_source_pdf(session, artifact_id)
            session.execute(delete(MaterialProcessingRun).where(MaterialProcessingRun.material_id == material_id))
            session.execute(delete(Artifact).where(Artifact.artifact_id == artifact_id))
            session.execute(delete(Material).where(Material.material_id == material_id))
        reconcile_discarded_sources(dsn=dsn, artifact_id=artifact_id)
        return True
    except Exception as error:
        # 包含 commit 結果不明的連線錯誤；由新 transaction 查 DB authority 決定還原或 unlink。
        if artifact_id is not None:
            reconcile_discarded_sources(dsn=dsn, artifact_id=artifact_id)
        if isinstance(error, MaterialDiscardError):
            raise
        raise MaterialDiscardError("MATERIAL_DISCARD_STORAGE_FAILED") from None


def finish_material_discards(*, dsn: str | None = None) -> None:
    """Startup / worker retry: persisted intent and quarantine are the only recovery records."""
    reconcile_discarded_sources(dsn=dsn)
    with database_session(dsn) as session:
        identities = session.execute(select(Material.learner_id, Material.material_id).where(Material.discard_requested_at.is_not(None))).all()
    for learner_id, material_id in identities:
        purge_discarded_material(learner_id, material_id, dsn=dsn)
