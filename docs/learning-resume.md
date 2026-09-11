# 原學習、題目與作答恢復

教材庫有既有學習時，優先顯示「接續上次學習」（已完成者為「查看上次學習」）。
預設開啟最近建立的 session；教材詳情可選擇其他既有學習紀錄。每筆紀錄使用原 session
的 exact Knowledge Structure revision，不會因教材有較新版本而轉移進度。

- 保存原 current concept、session status、no-safe claim、deferred concept 與 progress。
- 進入 session 時，預設讀取目前概念最近產生的題目；已完成 session 則讀最近的題目。
- 「題目與作答紀錄」可選取舊題。所選 Assessment 寫入瀏覽器網址，reload 仍讀同一題。
- 未答題恢復原問題及選項；已答題恢復原 AnswerEvent、選項及回饋。過去位置或已完成
  session 的未答題只供查看，不能透過舊題提交改變目前狀態。
- 「回到目前學習」回到目前概念預設題目；不套用 guidance 或新增題目。
- 提交後若斷線／回應遺失，按「查回作答結果」進行唯讀查詢。若後端已提交，就顯示原結果；
  未提交則仍為未作答。既有相同 idempotency key 重送維持同一結果，衝突仍拒絕。
- Map 中「開始新的學習」與「從這個概念開始新的學習」才會建立 session；「開始評量」／
  「取得目前概念的新題目」才會請求生成。restore 失敗有重讀及返回教材庫，不自動建立替代資料。

完成的 session 可看原題、回饋與 progress。no-safe 仍保留既有教材回顧、暫緩或結束出口，
不捏造題目或掌握度。跨 session mastery 合併、跨 revision 轉移、未提交選項、Map viewport
與完整分析型歷史介面不在此功能內。

## API／資料契約

新增唯讀入口：

```text
GET /v1/materials/{material_id}/knowledge-structures/{structure_revision}/study-sessions/{study_session_id}/resume
    ?run_id={run_id}&assessment_revision={optional_assessment_revision}
```

`study-resume/v1` 回應包含 `session`、`run_id`、`source_artifact_id`、`knowledge_structure`、
`progress`、`assessments` 和 `selected_assessment_revision`。每筆題目紀錄只有 public Assessment、
產生時間、`can_submit` 與 nullable feedback；未答題不公開私人答案。

後端檢查目前 learner、material、run、exact KS revision、session 與選取題目是否一致。
錯 owner／binding／不屬於該 session 的題目回 404；無 session 回 401；讀取期間學習狀態
改變回 409，讓前端重讀。新入口沿用 private/no-store，拒絕 client 指定 learner。

既有 `material-library-item/v1` 增加 `study_sessions`，提供原 session/revision/run 的唯讀連結；
既有 `study-session/v2` 增加已保存的 `no_safe_claim_ids`。其餘 scoring、mastery、stale、
idempotency 與 guidance authority 不變。沒有 migration、新資料表、新 dependency 或模型改動。

[本地測試](testing.md#learning-resume-regression-local-only) 使用真 Browser/API/PostgreSQL 與
controlled fixtures，驗證 reload、新 profile 重登、真提交後 response 遺失，以及 restore 零寫入／
零模型呼叫；不取代後續單元 D 的整合與正常啟停驗收。
