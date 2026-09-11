# 帳號入口視覺

依設計組 08.19 General UI V1.0 的 Login／Register 規範重建獨立雙欄 Auth Card。
1536×1024 viewport 下，卡片為 716×704px、水平垂直置中、左右 45:55；登入前不顯示產品 Header。
沿用藍白 tokens、角色、植物／波浪背景與學習圖示層，主 CTA 全寬，切換頁面使用底部文字連結。

- `/login`：登入您的帳戶。
- `/register`：建立新帳戶，含確認密碼；重新載入保留所在頁面。
- 密碼可顯示／隱藏；錯誤訊息保留在表單內。
- 既有 backend username/password 與 session 契約不變，不偽裝成 Email 登入。
- 本次未加入 display name、email、保持登入選項或忘記／重設密碼服務，因此不是原四欄註冊稿的完整功能複製。

素材直接取自組員交付的 `Studydy_General_UI_Runtime_Assets_V1.0.zip`，保留原檔、Alpha、比例與路徑：

- `Studydy_角色素材/鼓勵/小於60_/LT60.png`
- `Studydy_角色素材/歡迎/welcome_present.png`

沒有重畫、修圖或重新生成角色。來源檔與設計資料夾不修改。

驗證包含 Playwright MCP 的桌面／窄螢幕截圖、幾何量測、圖片載入、密碼顯示、確認密碼拒絕、
真註冊／登出／重登；自動化沿用本地帳號 Browser fixture，另檢查獨立網址與版型尺寸。
