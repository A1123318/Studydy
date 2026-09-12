import assert from "node:assert/strict";
import test from "node:test";

import { materialProgressStageLabel, materialCurrentStagePercent, materialOverallProgressPercent, materialRunHasUsableMap, maximumPdfBytes, validatePdfFile, validatePdfSelection } from "./material-flow.ts";

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


function processing(stage, completed, total = 45, status = "running") {
  return { progress_stage: stage, completed_pages: completed, total_pages: total, status };
}

test("processing projections distinguish measured stage work from structural overall estimates", () => {
  for (const [stage, completed, overall, current] of [
    ["queued", 0, 0, null], ["evidence", 0, 0, 0], ["evidence", 3, 3, 7], ["evidence", 45, 49, 100],
    ["semantics", 0, 49, 0], ["semantics", 20, 71, 44], ["semantics", 45, 99, 100], ["publishing", 45, 99, null],
  ]) {
    assert.equal(materialOverallProgressPercent(processing(stage, completed)), overall);
    assert.equal(materialCurrentStagePercent(processing(stage, completed)), current);
  }
  for (const status of ["succeeded", "partial"]) {
    assert.equal(materialOverallProgressPercent(processing("completed", 45, 45, status)), 100);
    assert.equal(materialCurrentStagePercent(processing("completed", 45, 45, status)), 100);
  }
  assert.equal(materialProgressStageLabel("queued"), "等待處理資源");
  assert.equal(materialProgressStageLabel("publishing"), "發布知識地圖");
});

test("progress handles unknown/invalid denominators and clamps without declaring early completion", () => {
  assert.equal(materialOverallProgressPercent(processing("queued", 0, null, "pending")), 0);
  for (const total of [null, 0, -1, NaN, Infinity, Number.MAX_VALUE]) {
    assert.equal(materialCurrentStagePercent(processing("evidence", 3, total)), null);
    assert.equal(materialOverallProgressPercent(processing("semantics", 3, total)), null);
  }
  assert.equal(materialCurrentStagePercent(processing("evidence", -4)), 0);
  assert.equal(materialCurrentStagePercent(processing("semantics", 99)), 100);
  assert.equal(materialOverallProgressPercent(processing("evidence", -4)), 0);
  assert.equal(materialOverallProgressPercent(processing("evidence", 99)), 49);
  assert.equal(materialOverallProgressPercent(processing("semantics", 99)), 99);
  assert.equal(materialOverallProgressPercent(processing("publishing", 500, 500)), 99);
  assert.equal(materialCurrentStagePercent(processing("evidence", Infinity)), null);
  assert.equal(materialOverallProgressPercent(processing("evidence", NaN)), null);
  assert.equal(materialOverallProgressPercent(processing("completed", 45, 45, "failed")), null);
  assert.equal(materialOverallProgressPercent(processing("semantics", 20, 45, "failed")), 71);
});

test("legal lifecycle projections never decrease as stage page counts reset", () => {
  for (const total of [1, 45, 500]) {
    const snapshots = [processing("queued", 0, null, "pending")];
    for (const stage of ["evidence", "semantics"]) {
      for (let completed = 0; completed <= total; completed++) snapshots.push(processing(stage, completed, total));
    }
    snapshots.push(processing("publishing", total, total), processing("completed", total, total, "succeeded"));
    const values = snapshots.map(materialOverallProgressPercent);
    assert.equal(values[0], 0); assert.equal(values.at(-1), 100);
    assert.ok(values.slice(0, -1).every(value => value >= 0 && value <= 99));
    assert.ok(values.every((value, index) => index === 0 || value >= values[index - 1]));
  }
});
