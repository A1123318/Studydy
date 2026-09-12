# 取消教材處理

取消只停止指定 learner 所擁有的單一 processing run。Material、source PDF、先前已發布的 Knowledge Structure 與 StudySession 全部保留。沒有刪除、重新分析、pause/resume 或 resident 模型控制功能。

## Canonical contracts

- Run：`material-processing-run/v5`，新增 nullable `cancel_requested_at`。
- 教材集合／項目：`material-library/v2`、`material-library-item/v2`；`latest_attempt` 同步投影取消意圖。
- 已發布 binding 保持 `material-run-output-binding/v4`。
- 不提供舊 run v4／library v1 相容回應。

`POST /v1/material-processing-runs/{run_id}/cancel` 要求 CookieSession 與正確 Origin，拒絕 query parameters 和非空 body。不需要 Idempotency-Key，回傳目前 run v5。跨 learner 為 404；其他錯誤沿用固定、安全的 API error contract。

| DB state | Cancel response / transition |
|---|---|
| pending | 立即 cancelled；request、completion、updated 時間使用同一 DB clock 值 |
| running queued/evidence/semantics | 首次寫入 cancel_requested_at，仍 running；重複請求不改 timestamp |
| running publishing | 不接受新的取消意圖，原樣回傳 |
| succeeded / partial / failed / cancelled | 原樣回傳 |

沒有正式 `cancelling` status。「正在取消處理」只由 running + non-null cancel_requested_at 推導。

## Worker 與 race

claim、取消要求、progress checkpoint、failure 使用相同 run row lock。

- cancel 先於 publishing：checkpoint 提交 cancelled 後正常 unwind，不發布新 structure。
- publishing 先取得鎖：後來的取消不被接受，發布繼續。
- cancel 先於 failure：取消意圖優先，terminal 為 cancelled、error_code 為 null。
- failure 先完成：後來的取消不改寫既有 failure。
- restart recovery：有取消意圖的 running 轉 cancelled；其他 running 維持原 RESTART_INTERRUPTED failure 行為。

Checkpoint 包含 runtime work 前、preflight 後、每個 evidence page／semantic bundle 的 progress、evidence → semantics 前、下一個 bundle／semantic retry 前與 publishing transition。取消 terminal 必須先 commit，之後才拋內部 unwind signal，避免 transaction rollback 撤銷取消。

已在執行中的單一 OCR／Qwen request 可以先完成，下一個 checkpoint 才停止。取消不 kill backend、worker 或共享 Qwen/vLLM；沿用 pipeline 對自己所擁有暫存資源的既有 cleanup。

## Frontend

pending 與可取消的 running 顯示 inline confirmation。第一次點擊不送 API；確認時防止重複送出，GET polling 繼續。API 回傳／GET 觀察到取消意圖後顯示「正在取消處理」，只有 terminal cancelled 才顯示「已取消教材處理」。Reload 由 persisted fields 重建畫面。

取消 POST 的失敗是獨立 task alert，不把 run 改成 failed。Publishing 贏得 race 時顯示不能再取消的 notice。舊 GET 或較舊 POST 不能蓋掉新的取消意圖或 terminal 狀態。Cancelled 不投影為 100% 成功。

## Migration 與啟動

`0005_material_processing_cancellation.sql` 只新增欄位並替換實際 PostgreSQL 的 status／lifecycle constraints；0001–0004 checksum 不變，也不改寫既有 run data。

版本切換需協調舊 worker：已在舊程式中執行的 run 不會因檔案更新而取得新的 checkpoint。先讓舊 worker 的工作結束，再套用 migration 並啟動新 backend/frontend；不要混用舊 worker 與新的取消契約，也不要以 kill resident service 代替取消。

## Deterministic verification

`backend/tests/runtime/test_processing_cancellation.py` 使用 disposable PostgreSQL、Event-controlled row-lock ordering 和 stubbed analysis。`backend/tests/test_material_pipeline_v1.py` 驗證 callback 不會開啟下一個 bundle/retry。Browser cases 在 `frontend/e2e/processing-cancel.spec.ts`，包含 publishing race、POST failure、GET/POST late response、reload、mobile confirmation 與舊地圖入口。這些測試不需要 A40、Qwen、OCR 或 model qualification。
