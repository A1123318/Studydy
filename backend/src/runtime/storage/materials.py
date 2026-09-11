from __future__ import annotations

from uuid import UUID

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from .database import DatabaseConfigurationError
from .tables import Artifact, KnowledgeStructure, Material, MaterialProcessingRun, database_session


class MaterialLibraryError(RuntimeError):
    """教材庫儲存錯誤不包含 SQL、名稱或連線資訊。"""


def read_material_library(
    learner_id: UUID, *, material_id: UUID | None = None, dsn: str | None = None,
) -> list[dict]:
    """直接投影自己的教材、最新嘗試與已發布版本，不生成或恢復學習狀態。"""
    try:
        with database_session(dsn) as session:
            statement = select(
                Material.material_id, Material.source_artifact_id, Material.display_name,
                Material.created_at, Artifact.size_bytes,
            ).join(Artifact, (Artifact.artifact_id == Material.source_artifact_id)
                   & (Artifact.material_id == Material.material_id)
                   & (Artifact.learner_id == Material.learner_id)).where(Material.learner_id == learner_id)
            if material_id is not None:
                statement = statement.where(Material.material_id == material_id)
            materials = session.execute(statement.order_by(Material.created_at.desc(), Material.material_id.desc())).mappings().all()
            if not materials:
                return []
            ids = [row["material_id"] for row in materials]
            runs = session.execute(select(
                MaterialProcessingRun.material_id, MaterialProcessingRun.run_id,
                MaterialProcessingRun.status, MaterialProcessingRun.progress_stage,
                MaterialProcessingRun.completed_pages, MaterialProcessingRun.total_pages,
                MaterialProcessingRun.error_code, MaterialProcessingRun.created_at,
            ).where(
                MaterialProcessingRun.learner_id == learner_id,
                MaterialProcessingRun.material_id.in_(ids),
            ).distinct(MaterialProcessingRun.material_id).order_by(
                MaterialProcessingRun.material_id, MaterialProcessingRun.created_at.desc(), MaterialProcessingRun.run_id.desc(),
            )).mappings().all()
            structures = session.execute(select(
                KnowledgeStructure.material_id, KnowledgeStructure.run_id,
                KnowledgeStructure.structure_revision.label("knowledge_structure_revision"),
                KnowledgeStructure.created_at, MaterialProcessingRun.status,
            ).join(MaterialProcessingRun, (MaterialProcessingRun.run_id == KnowledgeStructure.run_id)
                   & (MaterialProcessingRun.learner_id == KnowledgeStructure.learner_id)
                   & (MaterialProcessingRun.material_id == KnowledgeStructure.material_id)
            ).join(Material, (Material.material_id == KnowledgeStructure.material_id)
                   & (Material.learner_id == KnowledgeStructure.learner_id)
                   & (Material.source_artifact_id == MaterialProcessingRun.source_artifact_id)
            ).where(
                KnowledgeStructure.learner_id == learner_id,
                KnowledgeStructure.material_id.in_(ids),
                MaterialProcessingRun.status.in_(("succeeded", "partial")),
                MaterialProcessingRun.output_binding["knowledge_structure_revision"].astext == KnowledgeStructure.structure_revision,
            ).order_by(KnowledgeStructure.created_at.desc(), KnowledgeStructure.run_id.desc())).mappings().all()
    except (DatabaseConfigurationError, SQLAlchemyError):
        raise MaterialLibraryError("MATERIAL_LIBRARY_STORAGE_FAILED") from None

    latest = {row["material_id"]: {key: value for key, value in row.items() if key != "material_id"} for row in runs}
    published: dict[UUID, list[dict]] = {identity: [] for identity in ids}
    for row in structures:
        published[row["material_id"]].append({key: value for key, value in row.items() if key != "material_id"})
    return [{
        "schema": "material-library-item/v1",
        **row,
        "display_name": row["display_name"] or f"教材 {row['created_at']:%Y-%m-%d} · {str(row['material_id'])[:8]}",
        "latest_attempt": latest.get(row["material_id"]),
        "available_structures": published[row["material_id"]],
    } for row in materials]
