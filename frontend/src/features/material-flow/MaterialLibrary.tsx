import { useEffect, useState } from "react";

import { errorMessage, type StudydyApiClient } from "../../api/client";
import type { MaterialLibraryItem, MaterialStructureLink, StudySessionLink } from "../../api/contracts";
import { writeRoute } from "../../app/routes";
import { StateView } from "../../ui/StateView";
import { formatFileSize, materialFailureMessage, materialProgressStageLabel, materialRunLabel } from "./material-flow";

function openStructure(item: MaterialLibraryItem, structure: MaterialStructureLink) {
  writeRoute({ name: "knowledge-map", materialId: item.material_id, runId: structure.run_id, structureRevision: structure.knowledge_structure_revision });
}

function openStudy(item: MaterialLibraryItem, session: StudySessionLink) {
  writeRoute({ name: "study-session", materialId: item.material_id, runId: session.run_id,
    structureRevision: session.knowledge_structure_revision, studySessionId: session.study_session_id });
}

export function MaterialLibrary({ apiClient, materialId }: { apiClient: StudydyApiClient; materialId?: string }) {
  const [items, setItems] = useState<MaterialLibraryItem[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const read = async () => {
      try {
        const materials = materialId ? [await apiClient.getMaterial(materialId)] : (await apiClient.listMaterials()).materials;
        if (cancelled) return;
        setItems(materials);
        setMessage(null);
        if (materials.some(item => item.latest_attempt?.status === "pending" || item.latest_attempt?.status === "running")) {
          timer = window.setTimeout(read, 3000);
        }
      } catch (error) {
        if (!cancelled) setMessage(errorMessage(error));
      }
    };
    void read();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [apiClient, materialId, reload]);

  if (message) return <StateView title="無法讀取教材" description={message} tone="failure" action={<>
    <button className="primary-button" type="button" onClick={() => { setMessage(null); setItems(null); setReload(value => value + 1); }}>重新讀取</button>
    <button className="secondary-button" type="button" onClick={() => writeRoute({ name: "home" })}>返回教材庫</button>
  </>} />;
  if (items === null) return <StateView title="正在讀取教材庫" description="正在載入你的教材與已發布結果。" tone="loading" live />;
  return <section className="material-library">
    <header className="library-header">
      <h1>{materialId ? "教材詳情" : "我的教材"}</h1>
      <div className="state-actions">
        {materialId && <button className="secondary-button" type="button" onClick={() => writeRoute({ name: "home" })}>返回教材庫</button>}
        <button className="secondary-button" type="button" onClick={() => setReload(value => value + 1)}>重新整理</button>
        <button className="primary-button" type="button" onClick={() => writeRoute({ name: "upload" })}>上傳教材</button>
      </div>
    </header>
    {items.length === 0 && <StateView title="還沒有教材" description="上傳一份 PDF，之後可從這裡找回教材與知識地圖。" tone="empty" />}
    {items.map(item => {
      const latest = item.latest_attempt;
      const available = item.available_structures;
      return <article className="surface library-item" key={item.material_id} aria-label={item.display_name}>
        <h2>{materialId ? item.display_name : <button className="library-title" type="button" onClick={() => writeRoute({ name: "material-detail", materialId: item.material_id })}>{item.display_name}</button>}</h2>
        <p>{new Date(item.created_at).toLocaleString()} · {formatFileSize(item.size_bytes)}</p>
        <p>最新處理：{latest ? materialRunLabel(latest.status) : "已上傳，尚未開始處理"}</p>
        {latest && (latest.status === "running" || latest.status === "pending") && <p>{materialProgressStageLabel(latest.progress_stage)} · 已完成 {latest.completed_pages} 頁{latest.total_pages !== null && `／共 ${latest.total_pages} 頁`}</p>}
        {latest?.status === "failed" && <p>{materialFailureMessage(latest.error_code ?? "")}{available.length > 0 && " 先前已發布的知識地圖仍可開啟。"}</p>}
        <div className="state-actions">
          {item.study_sessions[0] && <button className="primary-button" type="button" onClick={() => openStudy(item, item.study_sessions[0])}>{item.study_sessions[0].status === "completed" ? "查看上次學習" : "接續上次學習"}</button>}
          {available[0] && <button className="primary-button" type="button" onClick={() => openStructure(item, available[0])}>開啟知識地圖</button>}
          {latest && <button className="secondary-button" type="button" onClick={() => writeRoute({ name: "material-run", materialId: item.material_id, runId: latest.run_id })}>查看最新處理</button>}
          {materialId && <a className="secondary-button" href={apiClient.sourceArtifactUrl(item.source_artifact_id)} target="_blank" rel="noreferrer">開啟原始 PDF</a>}
        </div>
        {available.length === 0 && <p>目前沒有可開啟的已發布知識地圖。</p>}
        {materialId && item.study_sessions.length > 0 && <section aria-label="學習紀錄">
          <h3>既有學習紀錄</h3>
          <ul>{item.study_sessions.map((session, index) => <li key={session.study_session_id}>
            <span>{new Date(session.started_at).toLocaleString()} · {session.status === "completed" ? "已完成" : session.status === "no_safe" ? "目前沒有安全題目" : "學習中"}</span>{" "}
            <button className="secondary-button" type="button" onClick={() => openStudy(item, session)}>開啟學習紀錄 {item.study_sessions.length - index}</button>
          </li>)}</ul>
        </section>}
        {materialId && available.length > 0 && <section aria-label="已發布版本">
          <h3>已發布版本</h3>
          <ul>{available.map((structure, index) => <li key={structure.knowledge_structure_revision}>
            <span>{new Date(structure.created_at).toLocaleString()} · {structure.status === "partial" ? "部分內容待複核" : "處理完成"}</span>{" "}
            <button className="secondary-button" type="button" onClick={() => openStructure(item, structure)}>開啟版本 {available.length - index}</button>
          </li>)}</ul>
        </section>}
      </article>;
    })}
  </section>;
}
