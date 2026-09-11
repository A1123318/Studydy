# 登入後首頁與教材頁

沿用設計組 08.19 General UI V1.0 的共用 Desktop Shell、首頁 Hero／摘要／功能介紹與空資料構圖。

- `/` 是首頁；`/materials` 是我的教材；`/knowledge-maps` 列出有已發布結果的教材。
- Desktop Header 為 87px 高單列、Sidebar 為 280px；登出按鈕維持一般操作尺寸，不被 Grid 拉伸。
- Sidebar 保留首頁、知識地圖、我的教材、設定的順序；未實作的設定明確停用。
- 不建立假搜尋、通知數字、SC 使用者名稱或沒有作用的按鈕。
- 首頁只查詢既有 learner-owned material library：教材數、可開啟地圖的教材數、session 數、completed session 數。
  未有統計 API 的學習時間／完成測驗數不以假數字替代；讀取中與失敗顯示「—」。
- 接續學習沿用原 session、run、exact KS revision；新增版型不改變 API、生成、作答或 progress 行為。
- 教材與地圖採格狀卡片；新版失敗仍保留先前已發布結果。詳情與歷史選擇沿用既有流程。
- 空資料使用組員原始 `空資料/empty_disappointed.png`，主 CTA 與說明位於同一中央區塊。
- Hero 使用組員原始 `引導/guide_present.png`；PNG 不重畫、不裁切，文件装飾為獨立 UI 圖層。

驗證：Playwright MCP 桌面／窄視窗檢查與實際導覽；本地真 Browser/API/DB 回歸比對非空資料的
摘要值與 owner 隔離、reopen、resume；模擬讀取失敗時不顯示假的零值。
