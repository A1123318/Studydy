# 帳號與固定學習身分

先依 [工作站啟停說明](runbook/A40_FINAL_WORKSTATION.md) 準備既有本地服務。
正式產品仍沿用現行模型 preflight，不新增無 GPU 模式。

## Migration

先停止產品寫入；若資料需要保留，人工私下備份原 DB 與整套原始 PDF store。
保持既有 `STUDYDY_DATABASE_DSN` 和 `STUDYDY_ARTIFACT_ROOT`，不要清空或更換位置。
在已設定私有環境欄位的 shell，從 repository root 執行：

```bash
PYTHONPATH=backend/src backend/.venv/bin/python -c 'from runtime.storage.migrations import run_migrations; print(run_migrations())'
```

空 DB 套用全部現行 migrations；`0002` 加入帳號，`0003` 加入教材名稱；再執行回傳 `()`。
`0001` 不變，`0002` 只在 `learners` 新增 nullable username/password_hash 與約束。
既有 learner、session、教材、學習與作答資料全部保留，不修改 owner。舊匿名 learner
不會自動綁定帳號；本單元未提供匿名資料搬移。不同初始 migration checksum 的舊實驗 DB
不在這個升級範圍內，請勿刪除 migration ledger 或重新建立空 DB 來繞過檢查。

## 使用

1. 開啟 Studydy，選「建立新帳號」。帳號名稱為 3–32 個英文字母、數字或底線，不分大小寫。
2. 密碼為 15–128 個字元，可包含空格；沒有密碼重設服務，請自行妥善保存。
3. 註冊成功後進入教材庫；右上角「登出」只撤銷本次授權，不刪除資料。
4. 新瀏覽器輸入相同帳密，後端會取得同一 learner。其他瀏覽器的有效 session 可繼續使用。
5. session 有效時沿用 idle refresh（7 天，最長 30 天）；過期需重新登入。失敗的上傳／作答
   不會自動重送，請登入後明確操作。登出失敗時私有畫面仍清空，請按「再試一次」完成登出。

登入後可從[教材庫](material-library.md)找回教材；學習歷史恢復 UI 尚未提供。原有直接網址仍受後端 owner 檢查保護。
不再使用未區分帳號的 localStorage 最近教材指標。切換帳號會清除頁面內私有狀態；同 origin
其他分頁會收到身分變更通知，須重新登入後再操作。

## API

所有 mutation 必須帶符合現有設定的 `Origin`，仍使用 HttpOnly、SameSite=Strict cookie；
除數字 loopback HTTP 的 local profile 外要求 Secure。API 和 PDF 回應均為 `private, no-store`。

| Method / path | 行為 |
|---|---|
| `POST /v1/accounts` | JSON `{username, password}`；201，建立帳號並登入 |
| `POST /v1/session/login` | 同樣 JSON；200，驗證帳密並登入原 learner |
| `GET /v1/session` | 200，回傳 `learner-identity/v1` 與 `learner_id`；無有效 session 為 401 |
| `POST /v1/session/refresh` | 空 body；204，僅延長仍有效的既有 session |
| `DELETE /v1/session` | 空 body；204，冪等撤銷本次 session 並移除 cookie |

舊匿名 `POST /v1/session` 已移除。帳密錯誤統一回 `INVALID_CREDENTIALS`，名稱重複回
`ACCOUNT_UNAVAILABLE`，不回傳 password hash 或 session token JSON。
密碼使用標準函式庫 scrypt（N=2^17、r=8、p=1、隨機 16-byte salt），參數依
[OWASP Password Storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#scrypt)。
未加入新 dependency、OAuth、MFA、進階限流或第二套 identity system。

[本地帳號測試方式](testing.md#account-regression-local-only) 不需要雲端 pod 或模型啟動。
