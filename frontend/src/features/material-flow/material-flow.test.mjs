import assert from "node:assert/strict";
import test from "node:test";

import { materialProgressStageLabel, materialRunHasUsableMap, maximumPdfBytes, validatePdfFile, validatePdfSelection } from "./material-flow.ts";

test("final material stages and usable binding are direct", () => {
  assert.equal(materialProgressStageLabel("evidence"), "整理頁面與教材來源");
  assert.equal(materialProgressStageLabel("semantics"), "建立概念、關係與學習順序");
  assert.equal(materialRunHasUsableMap({ output_binding: { decision: "retain" } }), true);
  assert.equal(materialRunHasUsableMap({ output_binding: null }), false);
});

test("upload remains PDF-only and bounded", () => {
  assert.equal(validatePdfFile({ type: "application/pdf", size: 12 }), null);
  assert.match(validatePdfFile({ type: "text/plain", size: 12 }), /PDF/);
});


test("PDF selection preserves the one-file, non-empty, 100 MiB boundary", () => {
  assert.equal(validatePdfFile(null), "請先選擇 PDF 教材。");
  assert.equal(validatePdfSelection(null).message, "請先選擇 PDF 教材。");
  assert.equal(validatePdfSelection([]).message, "請先選擇 PDF 教材。");
  const valid = { type: "application/pdf", size: maximumPdfBytes };
  assert.deepEqual(validatePdfSelection([valid]), { file: valid, message: null });
  assert.equal(validatePdfFile({ ...valid, size: 0 }), "PDF 不可為空白檔案。");
  assert.equal(validatePdfFile({ ...valid, size: maximumPdfBytes + 1 }), "PDF 不可超過 100 MiB。");
  assert.match(validatePdfSelection([{ type: "text/plain", size: 20 }]).message, /不是可用的 PDF/);
  assert.deepEqual(validatePdfSelection([valid, valid]), { file: null, message: "一次只能處理一份 PDF 教材。" });
});
