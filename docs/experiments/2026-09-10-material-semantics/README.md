# 2026-09-10 教材語意分析實驗封存

**狀態：保留作研究與報告證據；不合併至 `dev`／`main`。** 這是嘗試過但尚未充分證明整體收益的實驗分支，不是已驗收的產品功能。後續閱讀請以本頁及來源覆蓋審計的限制為準；較早文件中的暫停、待批准或 qualified 字樣屬過程中的歷史判斷。

## 可直接放入後續報告的簡短說明

> 本專題針對教材的原生文字／OCR 分流、選擇性視覺輸入、token 預算、生成協定與分階段關係判讀進行實作及測試。共保留 70 次新模型生成紀錄，包含失敗與截斷；曾成功透過 production 執行路徑復現既有固定端點批次。完整教材及額外兩份一般課堂簡報的測試，仍顯示關係漏失與類型誤判，尚不足以證明整體品質穩定提升，因此保留此分支作為研究紀錄，未合併主線。文中語意分數是來源人工審查結果，並非獨立教師認證的準確率。

## 做了哪些嘗試

1. 保留 native-first 與 UnlimitedOCR，將 OCR 需求和視覺理解需求分開。
2. 將最多三張相關頁面送往同一個 resident Qwen；用頁碼與 render hash 追溯，維持文字 Evidence 權威。
3. 以實際 tokenizer 計算圖文輸入，維持 32K／單 sequence；嘗試較大 fresh-input 與 output 預算。
4. 修正硬 JSON 與原成功 native-thinking 協定的差異，完成一批 15 題原樣 production 復現。
5. 嘗試 off 形成 Concepts／Claims／候選關係，再由 Low 判斷配對；15、8 對曾失敗，4 對批次完成。
6. 依原 PDF 審查已產生的邊與核心關係覆蓋，並在固定程式／prompt／參數下測試兩份額外簡報。

正式 taxonomy、Assessment、單一模型生命週期及來源字面值保護未擴大重設。最後的判斷階段仍只看草稿提出的配對，不能補回未形成的端點或候選。

## 主要結果

| 測試 | Concepts / Claims / Relations | 來源支持／錯誤／不確定 | 保守 Relation precision |
|---|---:|---:|---:|
| A：45 頁程式教材，baseline | 60 / 84 / 72 | 34 / 35 / 3 | 47.2% |
| A：最後分階段候選 | 35 / 42 / 12 | 10 / 1 / 1 | 83.3% |
| B：26 頁資料結構簡報，原設定新推論 | 13 / 17 / 9 | 7 / 1 / 1 | 77.8% |
| C：37 頁績效評估簡報，原設定新推論 | 30 / 76 / 21 | 10 / 11 / 0 | 47.6% |

- A 的 83.3% 是已產出邊的 precision。相同 36 單元的完整獨立 Concept 覆蓋從 30 降至 29。另建的 48 條人工核心關係參考表只有 10 條命中：recall 20.8%、F1 33.3%；它不是唯一、完整或獨立認證的 gold graph。baseline 未對這份新參考表計算 F1。
- B 有一條理由將一維寫成一二維，另有一條 example 分類不確定；C 有六條分類歸屬誤標 part_of，以及五條表單／記錄實例誤標 application。這些是依現有類型定義的判斷，不代表所有相關來源敘述都錯誤。
- A 的五條 prerequisite 與 B 的一條未見明顯錯誤；C 沒有產生 prerequisite，不能計為 100% 正確。樣本不足以保證普遍可靠。
- 固定端點實際復現只有 15 題：完整 final JSON 與歷史原答案一致，P/N 11/12、P/N/I 11/14。歷史 Low 60 題的 38/42、39/52 是離線重算，沒有偽稱今天重跑全部 60 題。
- 最後 backend／local-AI regression 為 181 passed，一個既有 warning。這驗證程式契約，不驗證語意品質。

## 失敗和成本也保留

`runs.json` 收錄所有已記錄的新生成實驗；`generation-calls.json` 收錄逐次使用量與完成狀態。合計 70 次新 generation、996341 input tokens、169785 output tokens、278 次真實 OCR、7 次截斷、2 次早期自動重試。模型端 readback 為 63 stop／7 length、0 abort／error，token 累計吻合。

初期以硬 JSON 標示 Low 的測試不等同 native Low。native Low 聯合抽取及一次 12K output probe 曾截斷；分階段初版有任務 prompt／方向組合問題，修正後 15 對及 8 對仍曾截斷。沒有只保留成功版本。

A 最後一次 production pipeline 執行重用了已成功、經完整 request／render hash 核對的兩次草稿及 33 份 OCR；僅五次 Relation 判斷為新推論。原真實前段已在先前 run 計費，帳目不重複計算。B、C 皆為完整新 OCR／推論，沒有改設定或補跑，耗時分別 871.4、1728.5 秒。

已記錄測試 wall time 約 16510.9 秒，按當時觀察到的 A40 US$0.49/h 約 US$2.25。這不是帳單，不含啟動、審查／閒置與兩個未留存耗時的公開 probe。歷史 012 的呼叫不計入今日 70 次。

## 可核對的證據

| 檔案 | 內容 |
|---|---|
| `datasets.json` | 三份資料的匿名代號、頁數及原檔 SHA-256 |
| `runs.json`、`full-run-results.json` | 逐 run 結果、失敗、真實成本與重用標記 |
| `generation-calls.json`、`tokenizer-events.json` | 請求／messages hash、token 計數、finish reason、圖數；不含 payload |
| `runtime-settings.json` | 各 run 的實際 material prompt／參數及 model/context 設定；不含 endpoint／認證 |
| `relation-reviews.json`、`concept-coverage.json` | 去除私人標籤／引文後的逐項人工裁定、頁碼與彙總 |
| `source-core-review.json` | 48 條核心參考的 ID、類型、頁碼、命中／漏失和評分計算 |
| `protocol-validation.json`、`runtime-validation.json` | 原樣復現、離線 replay、schema、來源與 tokenizer 驗證、服務端 readback |
| `regression-tests.json` | 已記錄的 regression 結果及其證據限制 |
| `source-record-hashes.json` | 匯出來源紀錄的 hash，供持有私人封存者交叉核對 |
| `manifest.json` | 本公開證據包的檔案大小與 SHA-256 |
| `archive-verification.json` | 從 worktree 外私人封存重新匯出，12 個 JSON 與公開包逐位元一致 |
| `private-archive-receipt.json` | worktree 外私人封存的完整性收據；不是私人資料本身 |

可從任何 checkout 離線執行：

```sh
python3 docs/experiments/2026-09-10-material-semantics/verify_evidence.py
```

只需 Python 標準函式庫，不執行模型、不連網。驗證的是封存檔案及數據間的一致性，不能取代獨立的語意判讀。

## 保存邊界與限制

完整原 PDF、OCR、模型 final 回答、Knowledge Structure、逐條來源判讀、page renders、私有 harness 與歷史參考另保存在 worktree 外的私人封存。原資料目錄不移動、不刪除；刪除 worktree 仍不會刪除該副本。登入憑證、API token 與 Python cache 不屬測試證據，未納入封存或 Git。

公開分支不包含 `docs_local/`、教材引文、原始圖像或模型 payload。完整私人封存只在本機，未上傳 GitHub；持有者可用收據中的 archive hash 驗證。原本沒有留存的原始 API wrapper／推理前綴不補造；部分耗時是近似值，逐 run 已標示。原始 regression console transcript 未持久保存，因此其結果明確標示為當時報告紀錄，而不是重新製作的原始 log。

語意審查由同一 assistant 執行，非 blinded／獨立教師評分；類型邊界有判斷空間。B 與原有 prompt 的 queue/stack 通用例子有題材重疊；C 才是額外不同領域。沒有今日 Luna 同條件重測結果，也不據此否定使用者先前 Luna 的較佳結果。這些資料支持「確有嘗試與可追溯觀察」，不支持無條件的整體改善、模型能力極限或開源／大模型因果結論。

相關敘述：[實作與主要資格紀錄](../../material-semantics-qualification.md)、[協定復現與歷史審計](../../material-semantics-protocol-audit.md)、[來源覆蓋審計](../../material-semantics-source-coverage-review.md)。
