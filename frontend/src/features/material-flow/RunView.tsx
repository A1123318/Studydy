import { useEffect, useState } from "react";

import { errorMessage, type StudydyApiClient } from "../../api/client";
import type { MaterialProcessingRunView } from "../../api/contracts";
import { writeRoute, type AppRoute } from "../../app/routes";
import { Icon } from "../../ui/Icon";
import { StateView } from "../../ui/StateView";
import {
  automaticPollIntervalMs,
  materialElapsedLabel,
  materialFailureMessage,
  materialProgressStageLabel,
  materialProgressStages,
  materialRunHasUsableMap,
  materialCurrentStagePercent,
  materialOverallProgressPercent,
} from "./material-flow";

export function RunView({ apiClient, route }: {
  apiClient: StudydyApiClient;
  route: Extract<AppRoute, { name: "material-run" }>;
}) {
  const [run, setRun] = useState<MaterialProcessingRunView | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const poll = async () => {
      try {
        const next = await apiClient.getMaterialRun(route.runId);
        if (cancelled) return;
        if (next.material_id !== route.materialId) {
          throw new Error("RUN_MATERIAL_MISMATCH");
        }
        setRun(next);
        setMessage(null);
        if (next.status === "pending" || next.status === "running") {
          timer = window.setTimeout(poll, automaticPollIntervalMs);
        }
      } catch (error) {
        if (!cancelled) {
          setMessage(errorMessage(error));
        }
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [apiClient, reload, route.materialId, route.runId]);

  useEffect(() => {
    if (!run || (run.status !== "pending" && run.status !== "running")) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [run?.run_id, run?.status]);

  if (message) return (
    <section className="processing-page task-page">
      <StateView
        action={<>
          <button className="primary-button" type="button" onClick={() => setReload(value => value + 1)}><Icon name="refresh" />重新讀取</button>
          <button className="secondary-button" type="button" onClick={() => writeRoute({ name: "materials" })}>返回我的教材</button>
        </>}
        description={message} image="/assets/studydy/failure-confused.png" title="無法讀取處理狀態" tone="failure"
      />
    </section>
  );

  if (!run) return (
    <section className="processing-page task-page" aria-live="polite">
      <header className="processing-hero">
        <img src="/assets/studydy/processing-laptop.png" alt="" />
        <div><p className="eyebrow">教材處理</p><h1>正在讀取處理狀態</h1></div>
      </header>
    </section>
  );

  if (run.status === "pending" || run.status === "running") {
    const currentStageIndex = materialProgressStages.indexOf(run.progress_stage);
    const currentPercent = materialCurrentStagePercent(run);
    const overallPercent = materialOverallProgressPercent(run);
    const stageLabel = materialProgressStageLabel(run.progress_stage);
    const stageActivity = run.progress_stage === "queued" ? "等待開始" : run.progress_stage === "publishing" ? "發布中" : "處理中";
    return (
      <section className="processing-page task-page">
        <header className="processing-hero">
          <img src="/assets/studydy/processing-laptop.png" alt="" />
          <div><p className="eyebrow">教材處理</p><h1>{run.status === "pending" ? "等待開始處理" : "正在分析教材"}</h1>
            <p>Studydy 正在整理教材內容並建立知識地圖，進度會自動保存。</p></div>
        </header>
        <div className="processing-grid">
          <section className="surface processing-card">
            <div className="processing-status" aria-live="polite">
              <div className="progress-heading"><h2>整體進度（估計）</h2><strong>{overallPercent === null ? "—" : `${overallPercent}%`}</strong></div>
              <progress className="processing-progress" max={100} value={overallPercent ?? undefined}
                aria-label={overallPercent === null ? "整體進度（估計），尚無可估計資料" : `整體進度（估計） ${overallPercent}%`} />
              <p className="progress-estimate-note">依頁面與階段完成度估算，並非耗時比例。</p>
              <h3>目前階段</h3>
              <div className="progress-heading"><strong className="stage-label">{stageLabel}</strong><strong>{currentPercent === null ? stageActivity : `${currentPercent}%`}</strong></div>
              {currentPercent === null
                ? <div className="indeterminate-progress" role="progressbar" aria-label={`目前階段：${stageLabel}，${stageActivity}`}><span /></div>
                : <progress className="processing-progress" max={100} value={currentPercent}
                    aria-label={`目前階段進度 ${currentPercent}%，已完成 ${run.completed_pages} / ${run.total_pages} 頁`} />}
              {currentPercent !== null && <p>目前階段已完成 {run.completed_pages} / {run.total_pages} 頁。</p>}
            </div>
            <dl className="processing-times">
              <div><dt>已經過</dt><dd>{materialElapsedLabel(run.created_at, now)}</dd></div>
              <div><dt>最近更新</dt><dd><time dateTime={run.updated_at}>{new Date(run.updated_at).toLocaleTimeString("zh-TW")}</time></dd></div>
            </dl>
            <p>你可以離開此頁，處理進度會自動保存，可稍後從「我的教材」返回查看。</p>
          </section>
          <section className="surface processing-card">
            <h2>實際處理階段</h2>
            <ol className="status-timeline">
              {materialProgressStages.slice(0, -1).map((stage, index) => (
                <li className={index < currentStageIndex ? "is-complete" : index === currentStageIndex ? "is-active" : undefined} key={stage}>
                  <span><Icon name={index < currentStageIndex ? "check" : stage === "semantics" ? "map" : "process"} /></span>
                  <div><strong>{materialProgressStageLabel(stage)}</strong><p>{index < currentStageIndex ? "此階段已完成。" : index === currentStageIndex ? "目前正在這個階段。" : "尚未開始。"}</p></div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </section>
    );
  }

  if (run.status === "failed") return (
    <section className="processing-page task-page terminal-failure">
      <StateView
        action={<button className="primary-button" type="button" onClick={() => writeRoute({ name: "materials" })}>返回我的教材</button>}
        description={materialFailureMessage(run.error_code ?? "MATERIAL_ANALYSIS_FAILED")}
        image="/assets/studydy/failure-confused.png" title="教材處理失敗" tone="failure"
      />
      <p className="failure-progress" role="status">
        最後安全進度：{materialProgressStageLabel(run.progress_stage)}
        {run.total_pages === null ? "" : `，${run.completed_pages} / ${run.total_pages} 頁`}
      </p>
      {run.error_code && <details className="processing-technical"><summary>技術資訊</summary><code>{run.error_code}</code></details>}
    </section>
  );

  if (!materialRunHasUsableMap(run)) return (
    <section className="processing-page task-page">
      <StateView
        action={<button className="primary-button" type="button" onClick={() => writeRoute({ name: "materials" })}>返回我的教材</button>}
        description="這份教材目前沒有可開啟的知識地圖，可以從我的教材查看已保存的處理紀錄。"
        image="/assets/studydy/empty-disappointed.png" title="目前沒有可開啟的知識地圖" tone="empty"
      />
    </section>
  );

  const binding = run.output_binding!;
  const partial = run.status === "partial";
  return (
    <section className="processing-page task-page is-complete">
      <header className="processing-hero">
        <img src="/assets/studydy/success-jump.png" alt="" />
        <div><p className="eyebrow">教材處理</p><h1>{partial ? "教材整理完成，部分內容待確認" : "教材整理完成"}</h1>
          <p>知識地圖已準備完成，可以查看概念、關係、來源與建議學習順序。</p></div>
      </header>
      <div className="processing-grid">
        <div className="processing-stack">
          <section className="surface processing-card material-result">
            <span className="file-kind"><Icon name="file" /></span>
            <div><h2>教材</h2><p>共處理 {binding.page_count} 頁</p></div>
            <span className={`status-badge ${partial ? "is-partial" : "is-success"}`}><Icon name="check" />{partial ? "部分內容待確認" : "處理完成"}</span>
          </section>
          <section className="surface processing-card result-summary">
            <h2>已發布內容</h2>
            <img src="/assets/studydy/processing-complete.png" alt="" />
            <ul>
              <li><Icon name="check" />可回查的概念與學習重點</li>
              <li><Icon name="check" />教材中的概念關係</li>
              <li><Icon name="check" />教材建議學習順序</li>
            </ul>
          </section>
        </div>
        <section className="surface processing-card">
          <h2>處理結果</h2>
          <div className="complete-progress"><strong>100%</strong><progress className="processing-progress" max={100} value={100} aria-label="教材處理完成 100%" /></div>
          <ol className="status-timeline">
            <li className="is-complete"><span><Icon name="check" /></span><div><strong>教材已接收</strong><p>教材已上傳並完成整理。</p></div></li>
            <li className="is-complete"><span><Icon name="check" /></span><div><strong>來源已保留</strong><p>可以回到原始 PDF 查看來源。</p></div></li>
            <li className="is-complete"><span><Icon name="check" /></span><div><strong>知識地圖已發布</strong><p>{partial ? "部分內容仍待確認，可先查看已發布的結果。" : "可以開始探索教材概念與關係。"}</p></div></li>
          </ol>
        </section>
      </div>
      <div className="surface completion-bar">
        <span className="completion-icon"><Icon name="check" /></span>
        <div><strong>{partial ? "已發布可查看的內容" : "知識地圖已準備完成"}</strong><p>可以查看概念、關係、來源與建議學習順序。</p></div>
        <button className="primary-button" type="button" onClick={() => writeRoute({
          name: "knowledge-map", materialId: run.material_id, runId: run.run_id,
          structureRevision: binding.knowledge_structure_revision,
        })}>開啟知識地圖<Icon name="chevron-right" /></button>
      </div>
    </section>
  );
}
