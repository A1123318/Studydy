# 帳號入口視覺

依設計組 08.19 General UI V1.0 的 Login／Register 規範重建獨立雙欄 Auth Card。
1536×1024 viewport 下，卡片為約 812×780px、水平垂直置中、左右 45:55；登入前不顯示產品 Header。
沿用藍白 tokens、角色、植物／波浪背景與學習圖示層，主 CTA 全寬，切換頁面使用底部文字連結。

- `/login`：登入您的帳戶。
- `/register`：建立新帳戶，含確認密碼；重新載入保留所在頁面。
- Email/password 是 UI、API 與 DB 的單一 credentials 契約，learner_id 仍是內部身份；詳見 [帳號契約與 migration](accounts.md)。
- 桌面標題約 30px、輸入與 CTA 高 56px；保留 45:55 雙欄、品牌與插圖。手機使用緊湊單欄，輸入字體 16px、高 50px。
- Login 不再顯示沒有其他登入方式的「或」divider，下方直接連到註冊。
- 密碼顯示／隱藏仍是具名 button；Email 欄位固定 id/name=email、type=email、autocomplete=username，保留 password-manager 支援。
- 表單 noValidate 關閉原生 popup，但保留 required、Email type 與 password 長度 constraints。
- 送出前不顯示紅色錯誤；送出時檢查所有欄位，錯誤以文字、aria-invalid、aria-describedby 關聯，focus 第一個錯誤欄位，修改輸入後更新對應錯誤。
- API/authentication 錯誤保留 form-level role=alert；登入錯誤統一為「Email 或密碼錯誤。」，資料服務／網路錯誤不冒充密碼錯誤。
- 等待 authentication 時禁用按鈕與輸入，同步提交鎖阻擋同一回合的重複 submit。
- 不加入第三方登入、驗證信、OTP、重設密碼或其他帳號管理功能。

素材直接取自組員交付的 `Studydy_General_UI_Runtime_Assets_V1.0.zip`，保留原檔、Alpha、比例與路徑：

- `Studydy_角色素材/鼓勵/小於60_/LT60.png`
- `Studydy_角色素材/歡迎/welcome_present.png`

沒有重畫、修圖或重新生成角色。來源檔與設計資料夾不修改。

驗證包含 Playwright 的 1536×1024、1920×1080、390×844 Login／Register 截圖、幾何量測、圖片載入、密碼顯示、確認密碼拒絕、
真註冊／登出／重登；自動化沿用本地帳號 Browser fixture，另檢查獨立網址與版型尺寸。
