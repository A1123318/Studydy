# 教材庫與重新開啟

登入後進入首頁，從 Sidebar「我的教材」或首頁 CTA 開啟教材庫（`/materials`）。教材列表由後端依目前 learner 查詢；新瀏覽器輸入相同帳密後，
不需 localStorage、教材 UUID 或保存過的網址，就能找到自己的教材。

- 「上傳教材」前往 `/upload`，沿用原 PDF 上傳和處理流程，保存檔案名稱供辨識。
- 每份教材顯示名稱、上傳時間、大小和最新處理狀態；只有完成上傳、尚未開始處理的教材也會列出。
- 「開啟知識地圖」讀取最近已發布的 exact Knowledge Structure，Map 中可切換「學習順序」。
- 點教材名稱進入詳情，可開啟原始 PDF、查看最新處理，或選擇先前已發布的版本。
- 最近處理若失敗，先前成功或 partial 的已發布版本仍保留，兩種狀態分開顯示。
- 處理中自動更新狀態；其他狀況可按「重新整理」。錯誤有重新讀取與返回教材庫的出口。

重新開啟只讀取既有 Material、Artifact、ProcessingRun 和 KnowledgeStructure，不呼叫模型、
不新增紀錄。有既有學習時，「接續上次學習」會讀回原 session、題目、回饋與 progress；
詳情提供既有學習紀錄選擇。「開始新的學習」是明確的獨立操作，見[學習恢復](learning-resume.md)。

## API 與 migration

| 入口 | 行為 |
|---|---|
| `GET /v1/materials` | `material-library/v1`，列出目前 learner 的全部教材 |
| `GET /v1/materials/{material_id}` | `material-library-item/v1`，只允許 owner 讀取詳情 |
| `POST /v1/materials` | 沿用 raw PDF body；選填 `X-Material-Name`，URI-encoded UTF-8 名稱 |

列表與詳情包含 `latest_attempt` 和 `available_structures`。後者每筆包含 exact `run_id`、
`knowledge_structure_revision`、發布時間及 succeeded／partial 狀態，不以最新失敗作業
代替已發布結果。Map、處理作業與 PDF 仍使用既有 GET 入口及 server owner 檢查。
新入口沿用 session cookie 和 `private, no-store`，不接受 client 指定 learner。

上傳名稱最多 200 個 Unicode 字元，不接受空白名稱、控制字元或路徑分隔符號。
名稱在首次成功上傳時固定；相同 idempotency key 搭配不同名稱或 PDF 回傳 409，不覆寫名稱。
未提供名稱的既有 consumer 仍可使用；舊 upload receipt 的 PDF fingerprint 不變。

`0003_material_display_name.sql` 只在 `materials` 新增 nullable `display_name` 和長度約束，
不新增資料表、不改寫 owner、PDF 或已發布內容。舊教材原本没有保存名稱，顯示「教材＋上傳日期＋
短識別碼」，不猜測原檔名。保持原 DB/PDF store，在既有私有環境設定下執行：

```bash
PYTHONPATH=backend/src backend/.venv/bin/python -c 'from runtime.storage.migrations import run_migrations; print(run_migrations())'
```

accepted 單元 A schema 回傳 `(3, 4)`，空 DB 回傳 `(1, 2, 3, 4)`，重跑回傳 `()`；第 4 版的 Email credential cutover 見 [帳號 migration](accounts.md#migration)。
本次沒有對正式資料庫執行 migration。

## 本地驗證

先 `npm --prefix frontend run build`，再依 [testing.md](testing.md) 執行 runtime tests。
教材庫 Browser fixture 使用本地 API、PostgreSQL 和 production frontend；登入後只從教材名稱
導航，重新建立 browser context 再次登入，分別開啟先前成功及 partial 版本。

測試比對七張產品表的完整內容摘要與筆數（含 Material、Artifact、Run、KS、StudySession、
Assessment、AnswerEvent），確認純 reopen 不變更資料；攔截後端 HTTP transport 確認零模型外呼。
來源為既有 controlled fixtures，不啟動模型、OCR 或雲端 Pod，不宣稱完成正式模型或整合驗收。
