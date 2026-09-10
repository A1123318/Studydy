# Material semantics：協定審計與 production 復現

**封存決策：此分支保留作研究紀錄，不合併 `dev`／`main`；未證明整體產品收益。** 今日成功、失敗及後續兩份簡報測試已整合至[完整證據索引](experiments/2026-09-10-material-semantics/README.md)。較早的 qualified／待批准文字僅反映當時狀態。


使用者已明確要求在 production 復現並完成必要測試。原 `012 low-01` 已透過 production `request_semantics` 共用的 `_execute_semantic_request`，向同一 resident Qwen 實際發出原樣 request；**15 題完整 final JSON 與原結果完全一致**，包含 status、type、direction、evidence 與 reason。

- 實際 body SHA-256：`002ca83c4e4f74d53c468de28fc692957df6cc6535d9c2959fba15db9c3a603d`。
- Input / output：21,136 / 5,184；finish `stop`；1 次 generation、1 次 tokenizer、0 重試；420.630 秒。
- 原 grader：P/N 11/12、P/N/I 11/14。這是原 60 題中的一批，不能報成重新完成 60 題。
- 原 60 題四批 Low 的離線重算仍為 38/42、39/52；沒有證據支持原測試造假的說法。
- 復現只有固定端點判斷。完整教材要自行形成端點，其品質需另行測量。

後續將相同 Low 分類任務接到 production 自行形成的端點後。第一次真實 45 頁抽取完成 33 次 OCR 與兩次草稿，但判斷階段的 prompt 混入草稿輸出要求，產生 supported + none direction；已修復 task prompt 並把原驗證器要求的合法 status/type/direction 組合移入 schema。原 60 個 Low decisions 中 59 個符合加強後形狀；剩下一個正是原 grader 已判錯的缺方向答案，未改原答案或 grader。

修復後的 15 對判斷仍用盡 8,192 output cap，沒有發布 graph。下一次保留全部 17 對，分為 8/8/1；成功的真實 OCR 與兩次草稿以 request/render hash 嚴格核對後重用。這些快取階段不算新的 OCR 或模型推論。原離線準備腳本已保留於未追蹤的資格驗證目錄，沒有加入產品腳本。最終結果與品質裁定見 [qualification report](material-semantics-qualification.md)。

最終 4/4/4/4/1 完成全部 17 對，得到 35 Concepts／42 Claims／12 Relations。來源審查為 10 supported、1 unsupported、1 uncertain，保守 precision 83.3%；Concept 完整獨立覆蓋 29/36，較 baseline 30/36 略退。新五次判斷 111950／15749 tokens、1301.442 秒、0 截斷／重試。完整結果、快取界線與全部失敗帳目見資格報告；不把一次成功解讀成普遍可靠。

## 歷史快照：使用者暫停期間

以下各節保留暫停時的調查與待批准方案，不代表目前執行狀態；其暫停限制已由使用者後續明確要求在 production 復現、繼續必要測試所取代。

**結論：先驗證成功協定、再擴大任務的順序被跳過了。**早期完整教材測試使用硬 JSON，後來又同時改 prompt、欄位順序、圖片選擇及分批，不能用這些結果判定原成功協定是否已正確移植。原產品目標未完成；新推論、重試及後續批次全部暫停，須取得使用者明確預算批准才可恢復。不得因 automatic goal continuation 自行恢復。

本輪沒有新增模型呼叫或 tokenizer 請求。只讀取既有檔案、檢查程序／服務狀態、收取暫停前已發出的唯一請求，並做離線驗證。未刪除 Pod、重啟 Qwen、變更模型或提高 context。

## 1. 012 原始結果的獨立重算

依 `20260909-012-reasoning-boundary` 的原始 `answer_content`（僅 final 區）重新解析，使用原 schema 驗證、原 15 個唯一 ID、`finish_reason=stop` 與記錄的 closing-boundary 條件，再呼叫原 `score.py` 的 `correct()`。沒有執行會覆寫原結果的 `main()`，沒有改評分標準，沒有修復答案或縮小固定分母。

| 原實驗 | P/N | P/N/I | 完整批次 | Input / output tokens | 原呼叫耗時 |
|---|---:|---:|---:|---:|---:|
| xhigh | 0/42* | 0/52* | 0/4 | 84,524 / 32,768 | 2,632.866 秒 |
| Low | **38/42** | **39/52** | **4/4** | **84,476 / 23,018** | **1,883.154 秒** |
| off | 28/42 | 29/52 | 4/4 | 84,364 / 4,261 | 406.215 秒 |

\* xhigh 的固定分母得分為零，是四批都截斷且不得採部分答案，不是可用答案的語意正確率為零。這些是歷史結果，本輪未重新推論。

Low 正例 exact 29/33；類型正確但方向錯 1；缺證據 exact 1/10。成功並不代表所有 Relation 類別都可靠，也不代表完整抽取已驗證。

| 雜湊驗證 | 本輪結果 |
|---|---|
| 原 manifest 的 12 個 request 檔 | 12/12 相符 |
| 原 download manifest 的 20 個結果／日誌檔 | 20/20 相符 |
| 以原 `build()`、原圖片與 seed 重建實際 body | 12/12 符合原 `request_sha256` |
| 原 final JSON 與儲存的 normalized decisions | 所有完整批次一致 |
| 原資料、答案與 grader 的前後指紋 | 50 個檔案集合及內容維持一致 |

原 `score.py` SHA-256：`5c3e80c3d2a0867db751c885cbdda31c29cbe8ff6e2853f1dbfc9ac397a28c6f`。

原 60 題 reference SHA-256：`8d35e7712335c3eb7c045cfd2f778769facfd3e444867a3ed5dd04d2e11c3102`。

限制：012 沒有保存完整原始 API response 或自由推理前綴。能重算的是原 final 區、使用量、邊界計數與既有雜湊；不能回推精確 thinking-token 數或重新核驗未保留的前綴全文。實際 body 雜湊依原程式的 sorted-JSON 規則計算，不冒稱為原 HTTP wire bytes 的雜湊。

## 2. 成功條件與目前 production 的差異

此處 production 指 feature 分支現在的程式及 runtime-lock；不是把測試 harness 的 Low override 當成已提交預設。

| 項目 | 012 成功 Low | 目前 feature／已跑候選 | 判定 |
|---|---|---|---|
| 模型／revision | Qwen3.8-27B-FP8；`017b9c7a…` | 相同 model ID、revision；目前啟動參數已讀回 | 已對齊設定；無歷史完整權重檔 hash |
| vLLM／Transformers／Torch | 歷史紀錄 0.28.0／5.15.1／2.13.0+cu130 | 目前讀回相同；`enforce_eager=true` | 已對齊紀錄版本 |
| Tokenizer | 同模型之 tokenizer；舊輸入計數已保留 | 未獨立指定 `--tokenizer-revision`；無舊 tokenizer 檔案 hash | 不足以證明逐位元一致；不得以版本號取代 byte proof |
| 服務上限 | 131,072 | **32,768、max_num_seqs=1** | 本任務必要差異；012 未留 max_num_seqs 的可核實值 |
| Text Evidence | 固定 282 筆、完整 sections，每批相同 | 原 artifact 411 筆，排除 129 筆非內容後也是 **282 筆**；全域 ID、順序、頁碼、kind、文字及完整 sections 全相同 | 文字內容已對齊；本輪最新 33 份 OCR blocks 亦與 baseline 相同 |
| 任務／messages | 15 個指定端點對＋完整 Evidence | 自行形成 Concepts、Claims、Relations；依 bundle 只給部分 Evidence，附 existing catalog | 任務擴大；actual messages 不相同 |
| 圖片 | 固定 16／19／29 頁，144 DPI；精確原 bytes | production 200 DPI，依 bundle／面積選最多 3 頁，再依預算降到 2 或 1 | 新增且未證實有效；圖片 hash 不同 |
| Prompt／schema／順序 | 原分類 prompt；`id,status,type,direction,evidence,reason` | 抽取 schema；Relation 改為 `k,r,s,t,e,c`；另加角色、粒度、反例等規則 | 未原樣移植；後加規則／順序效果未隔離 |
| 推理邊界 | 自由前綴 → `</think>` → strict-schema `<final_json>` | **目前文法代入原 schema 後完全相同**；早期 full runs 是硬 JSON | 初期落差已確認；目前不能再籠統歸因於缺少邊界 |
| 解析 | 原 final 區解析與 schema／15 ID 檢查 | 現 parser 可解析四份原 Low final（以記錄邊界包回）；另防重複 JSON keys、字串內 delimiter 提早結束 | final parser 離線通過；未聲稱重放未保存的原前綴 |
| Sampling／seed | temperature 1、top_p .95、top_k 20、min_p 0、presence 0、repetition 1；**seed 17001** | Sampling 相同；**full runs 未固定 seed** | seed 未移植，不能聲稱受控配對比較 |
| Thinking／budget | enable_thinking=true、Low；thinking＋final 共用 8192 | 測試曾覆寫 Low；**目前 lock 預設仍 xhigh／1536 fresh cap／4096 output**，但已套新文法 | 預設組合尚未資格驗證，不能當成可交付 production 設定 |
| 重試 | 失敗即留存，不補跑 | production 最多兩次 attempt；已發生兩次重試 | 012 的一次性成本控制未沿用；現在已凍結所有後續請求 |

另外，準備中的 `fixed_pairs.py` 使用修改過的 010 request：追加 prompt、改 schema 順序與圖片標籤，並非 012 原樣復現。它只做過 tokenizer preflight，沒有跑出新的固定端點成績；不得把該 preflight 當成 012 復現。

## 3. 根因與假設分開記錄

| 類別 | 已確認 | 尚未證實／不能推出 |
|---|---|---|
| 協定／實作不一致 | 最初硬 JSON 沒有 012 自由推理階段；復現準備工具引用了修改過的 010；seed／順序／圖片等也不同 | 不能用先前結果判定完整成功協定無效；目前 native grammar 本身未發現新的落差 |
| 任務擴大 | 固定端點分類變成端點形成、Claim grouping、跨 bundle catalog 與 Relation proposal | 固定端點 38/42 不代表完整抽取 precision 或 coverage |
| 輸出容量 | 8K native 大 bundle 兩次截斷；12K 同輸入 probe 截斷且曾進 final；4K input 候選第一 call 用盡 8192，未進 final | 只證明這些實際回覆耗盡 cap；未證明加預算、縮 bundle 或追加 prompt 能改善產品 |
| 語意錯誤 | 完整回覆中確實有錯誤 Relation type、方向、端點角色與 grounding；原 Low 也有 4 個 P/N 不符及 9 個 I 不符 | 不能把截斷、協定缺口和語意錯誤合成「模型不會」；不能隔離圖片或 Low 的因果效果 |

## 4. 本次分支已執行的模型測試帳目

下表不包含歷史 012 的呼叫。full wall time 包含 OCR、tokenizer 與傳輸；每個完成／啟動抽取的 full run 均實際 OCR 33 次。

| 測試 | 秒 | Input / output | 模型 calls | 截斷／重試 | 結果 |
|---|---:|---:|---:|---:|---|
| Baseline xhigh 1536/4096，硬 JSON | 1,918.4 | 170,081 / 19,282 | 20 | 1 / 1 | 完成 graph |
| Low text 8192/8192，硬 JSON | 856.4 | 19,277 / 7,098 | 2 | 0 / 0 | 完成 graph，品質未過 |
| Low visual，圖片驅動切批，硬 JSON | 1,276.8 | 183,143 / 9,649 | 10 | 0 / 0 | 完成 graph，跨頁／角色問題 |
| Low text v2，角色與欄位順序 | 710.0 | 17,272 / 5,008 | 2 | 0 / 0 | 完成 graph，品質未過 |
| Low visual v2，面積選圖 | 936.9 | 103,610 / 5,921 | 5 | 0 / 0 | 完成 graph，品質未過 |
| Low text 8192/8192，native thinking | 1,522.2 | 16,252 / 16,384 | 2 | 2 / 1 | 第一 bundle 失敗，無 graph |
| 同一第一 bundle，僅 output 改 12288 | 927.2 | 8,126 / 12,288 | 1 | 1 / 0 | probe 截斷，無 graph |
| 4K 候選首次啟動（相對 runtime 路徑） | 8.9 | 0 / 0 | 0 | 0 / 0 | `RUNTIME_LAYOUT_INVALID`，未 OCR／推論 |
| 4K 候選修正路徑後，收到暫停要求 | 約 928.7* | 3,960 / 8,192 | 1 | 1 / 0 | 已收第一 call；未進 final，沒有後續批次 |
| 公開三色 transport probe | 未留存 | 13,151 / 29 | 1 | 0 / 0 | 完成 |
| 公開三色 native-boundary probe | 未留存 | 13,237 / 162 | 1 | 0 / 0 | 完成 |
| **合計** | **已記錄約 9,085.5** | **548,109 / 84,013** | **45** | **5 / 2** | **231 次 OCR** |

\* 暫停回收使用 trace 檔 mtime 至收取時間，包含回收延遲，非精確 server latency；該語意 call 約 618.8 秒。兩個公開 probe 沒有逐 call wall time，不補造數字。tokenizer-only preflight 不屬模型 generation，沒有新的固定 60 題推論。

45 次 generation、84,013 output tokens、40 stop／5 length 與同一 engine 的累計 metrics 對上；error／abort 均為 0。最近檢查原 engine PID 928 仍在，沒有 engine death。這不冒稱全面排除所有未留存的 CUDA 警告。

以已觀察的 A40 US$0.49/h 折算，已記錄測試 wall time 約 **US$1.24**；不是帳單，不含啟動、審查／閒置時間及缺少 latency 的 probe。Pod 保持運行仍會計時。既有 regression suite 最後為 172 passed；最初 24 個 sandbox Docker fixture errors 已在授權環境重跑通過。

## 5. 最小修復與唯一待批准實驗

| 最小內容 | 可審閱結果 |
|---|---|
| 保留所有既有 production 成果；本輪不再改 prompt／schema／budget | 目前 tracked production code 仍為 `939aa50d8a1816196783c10e4483d54b77b853fa` |
| 只準備原始 012 `low-01`，不沿用修改版 010 | 新增 `backend/scripts/prepare_relation_replay.py`；無 HTTP、SSH、重試或執行模型功能；離線重建 body 並驗證原 hash，只輸出不含 payload 的 manifest |
| 防止舊 harness 越過使用者暫停 | 私有 SSH transport 在 `INFERENCE_PAUSED` 存在時於送出前拒絕 `/tokenize` 與 `/v1/chat/completions`；離線 mock 已驗證；不得自動移除 |
| 尚無證據的新 production 文法修補 | **不修改**；當前 grammar 與原格式離線相等，不能為了有 diff 再加規則 |

| 唯一建議實驗 | 凍結方案，尚未執行 |
|---|---|
| 範圍 | 原始 `low-01` 的同一批 15 題；最多 **1 次 generation**，0 重試，0 後續批次，0 新 OCR |
| 保留條件 | 原 messages／282 Evidence／端點 metadata／prompt／schema 與欄位順序／144 DPI 圖片 16、19、29／圖片標籤／thinking／sampling／seed 17001／8192 共用 output cap；request body 不改任何欄位 |
| 必要服務差異 | 131072 → 32768；目前 max_num_seqs=1、不同 Pod／engine instance。原 tokenizer byte hash、原 seq 上限及 cache／GPU 執行狀態無法重建；不得聲稱跨 instance 位元級輸出可重現 |
| 送出前停止條件 | 原檔或 reconstructed body hash 不符即停止。獲准後最多 1 次 resident tokenizer 計數，應為 21136；不符、身份／版本不符、或 `input+8192+1024>32768` 即停止，**不改 request 來硬湊** |
| 32K 算式 | 原 input 21136＋共用 output 8192＋margin 1024＝**30352**；保留 2416 餘量。尚未以本次服務 tokenize 原樣 request |
| 驗收 | finish=stop、關閉 thinking／final 區、原 schema、完整 15 唯一 ID、引用可用；以原 grader 比較原批次 P/N 11/12、P/N/I 11/14 及逐題差異。只完成格式表示協定成立；分數退步也照實保留、不補跑。絕不推出完整教材品質提升 |
| 呼叫後停止 | 不論成功、截斷、格式／引用錯誤、分數差異、OOM 或 transport failure，都在這唯一一次後停止；等待下一次明確決策。觀察逾時不重送 |
| 成本申請 | 原該批 438.659 秒，按 US$0.49/h 約 **US$0.060**。建議本次窗口上限 **15 分鐘／US$0.13**，含檢查與一次請求；到上限取消該請求而不重送，不重啟／刪除 Pod。這是待批准上限，不是完成時間承諾；不含既有 Pod 閒置費 |

## 6. 狀態與交付邊界

| 項目 | 目前狀態 |
|---|---|
| Pod | `v88a2undlj6p31`，provider 回報 **RUNNING**；未刪除或重啟 |
| Resident Qwen | 同一 engine PID **928**；32K、單 sequence；最後 metrics **0 running／0 waiting** |
| 暫停前在途請求 | 已收到 length 回覆；凍結 controller 從未恢復，其後終止；沒有重試／下一批 |
| Goal | **active、未完成**；使用者明確暫停模型測試，等待預算批准；不可標 complete |
| 分支 | `be/feature-multimodal-material-semantics`；base `4e44a010e8947b1211312ba3cd0d1f52c9a7de5b`；HEAD `939aa50d8a1816196783c10e4483d54b77b853fa` |
| 本輪 Git | 新增離線準備腳本與審計文件供 review，未 commit／merge／push；沒有改 dev |
| 私有資料 | 原 `docs_local`／答案／grader 未修改、未提交；沒有把圖片 payload 或教材原文加入 tracked files |

## 雜湊附錄：唯一建議批次

| 物件 | SHA-256 |
|---|---|
| `requests/low-01.json` 原檔 | `0a4929d960468a7e6790476fede19dc62aa8150d1954059de1dab5903f980610` |
| 含 seed／三圖的實際 body（原 canonical 規則） | `002ca83c4e4f74d53c468de28fc692957df6cc6535d9c2959fba15db9c3a603d` |
| 原 messages | `2caae44e60a765566caaf1bb56621f2685cfd4b094847f84aef635f04f4c5f9e` |
| 原 prompt | `192b9e87f086c5e4eb2d6453fa4f248135ed3638c05e8c75a98c011846f2e3af` |
| 原 sections | `3fa55820af710bd31e29f37cecb6813274c646445a81ff187335ed722fb56859` |
| 原 final schema | `4a5d19d1c27c8b4949e1c9903a7870ebaab2c16d300e20caa4c5c0c92c88d3b8` |
| 原保存輸出 | `40c55147949c74febc485a465b1fd4597be100ef39df8274ea01c47c96ecc5dc` |
| 原圖 page 16 | `984a59a21dcc119188b91557dab781ec41b25bf859bad3a4d1e54c87e08972a9` |
| 原圖 page 19 | `82ec94f22f82fc9ea0094f64c082411e11bf0a38c18d67a84055ea799b66ea0b` |
| 原圖 page 29 | `0ad30fbd98c0b8f16c2c73ab7c937117c12ed981afbe1210e0f3f1fc4b53cc32` |

逐批 hash、完整離線重算、呼叫帳目、Evidence 對齊證據與暫停回收紀錄均另存於未追蹤的私有資格驗證目錄；不覆寫原實驗資料。
