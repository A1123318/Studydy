import { expect, test, type Page, type Route } from "@playwright/test";

const materialId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const artifactId = "33333333-3333-4333-8333-333333333333";
const pdf = { name: "課程講義.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nSynthetic upload fixture\n%%EOF") };
const material = { schema: "material/v1", material_id: materialId, source_artifact_id: artifactId, source_sha256: "a".repeat(64), size_bytes: pdf.buffer.length };
const run = { schema: "material-processing-run/v4", run_id: runId, material_id: materialId, source_artifact_id: artifactId,
  status: "pending", progress_stage: "queued", completed_pages: 0, total_pages: null, output_binding: null, error_code: null,
  created_at: "2026-09-12T00:00:00Z", updated_at: "2026-09-12T00:00:00Z", completed_at: null };

async function signedIn(page: Page) {
  await page.route("**/v1/session/refresh", route => route.fulfill({ status: 204 }));
  await page.route("**/v1/session", route => route.fulfill({ json: { schema: "learner-identity/v1", learner_id: materialId } }));
  await page.route(`**/v1/material-processing-runs/${runId}`, route => route.fulfill({ json: run }));
}
async function failure(route: Route) {
  await route.fulfill({ status: 503, json: { schema: "api-error/v1", request_id: materialId, reason_code: "STORAGE_UNAVAILABLE", retryable: true, message: "Request could not be completed." } });
}
async function transfer(page: Page, files: { name: string; type: string; size?: number }[]) {
  return page.evaluateHandle(files => {
    const data = new DataTransfer();
    for (const file of files) data.items.add(new File([new Uint8Array(file.size ?? 20)], file.name, { type: file.type }));
    return data;
  }, files);
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1536, height: 1024 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  for (const state of ["initial", "selected", "long-name", "invalid", "oversized", "drag-over", "submitting", "api-failure"] as const) {
    test(`upload ${state} at ${viewport.width}px keeps the task usable`, async ({ page }) => {
      await page.setViewportSize(viewport); await signedIn(page);
      let calls = 0;
      await page.route("**/v1/materials", route => { calls++; return state === "submitting" ? undefined : failure(route); });
      await page.goto("/upload");
      const upload = page.locator(".upload-page");
      const input = page.getByLabel("選擇 PDF 教材", { exact: true });
      const submit = page.locator(".upload-card .full-button");
      await expect(upload.getByRole("heading", { name: "上傳教材", level: 1, exact: true })).toBeVisible();
      await expect(submit).toBeDisabled();
      await expect(input).toHaveAttribute("accept", "application/pdf");
      await expect(upload).toHaveAttribute("aria-labelledby", "upload-title");
      await expect(page.locator(".sidebar-helper")).toHaveCount(0);
      await expect(upload.locator(".step-number")).toHaveCount(0);
      await expect(upload.locator("img")).toHaveCount(1);
      await expect(upload.locator(".upload-aside > .surface")).toHaveCount(1);
      await expect(upload.getByRole("region", { name: "檔案需求" })).toContainText("PDF（.pdf）· 最大 100 MiB");
      await expect(upload.locator(".privacy-note")).toContainText("教材只交由本機 Studydy 流程處理");
      if (["selected", "long-name", "submitting", "api-failure"].includes(state)) {
        const file = state === "long-name" ? { ...pdf, name: "資料結構_" + "LongUnbrokenFilename".repeat(7) + ".pdf" } : pdf;
        await input.setInputFiles(file);
        await expect(upload.locator(".chosen-file strong")).toHaveText(file.name);
        await expect(upload.getByText(file.name, { exact: true })).toHaveCount(1);
        await expect(submit).toBeEnabled();
      }
      if (state === "invalid") await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
      if (state === "oversized" || state === "drag-over") {
        const data = await transfer(page, [{ name: "lecture.pdf", type: "application/pdf", size: state === "oversized" ? 100 * 1024 * 1024 + 1 : 20 }]);
        await page.locator(".file-drop").dispatchEvent(state === "oversized" ? "drop" : "dragenter", { dataTransfer: data });
        await data.dispose();
      }
      if (state === "submitting" || state === "api-failure") {
        await submit.click();
        await expect.poll(() => calls).toBe(1);
        if (state === "submitting") {
          await expect(submit).toBeDisabled(); await expect(input).toBeDisabled();
          await expect(upload.getByRole("button", { name: "移除", exact: true })).toBeDisabled();
          await expect(submit).toHaveText("正在上傳並建立分析…");
          await expect(page.locator(".file-drop")).toHaveClass(/is-disabled/);
        } else {
          await expect(upload.getByRole("alert")).toContainText("資料服務暫時無法使用"); await expect(submit).toBeEnabled();
          await expect(upload.locator(".chosen-file strong")).toHaveText(pdf.name);
          await expect(upload.locator(".chosen-file")).toContainText("準備上傳");
          await expect(upload.locator(".chosen-file")).not.toContainText("需要修正");
          await expect(upload.locator("#upload-submit-error")).toHaveAttribute("role", "alert");
          await expect(upload.locator("#upload-file-error")).toHaveCount(0);
          expect(await input.getAttribute("aria-invalid")).toBeNull();
          expect(await input.getAttribute("aria-describedby")).toBeNull();
          await expect(page).toHaveURL(/\/upload$/);
        }
      }
      if (state === "invalid" || state === "oversized") {
        await expect(upload.getByRole("alert")).toContainText(state === "invalid" ? "不是可用的 PDF" : "不可超過 100 MiB");
        await expect(upload.locator("#upload-file-error")).toHaveAttribute("role", "alert");
        await expect(upload.locator("#upload-submit-error")).toHaveCount(0);
        await expect(input).toHaveAttribute("aria-invalid", "true");
        await expect(input).toHaveAttribute("aria-describedby", "upload-file-error");
        await expect(upload.locator(".chosen-file")).toHaveCount(0); await expect(submit).toBeDisabled();
        expect(await input.inputValue()).toBe("");
      }
      if (state === "drag-over") await expect(page.locator(".file-drop")).toHaveClass(/is-dragging/);
      expect(await upload.evaluate(element => getComputedStyle(element).maxWidth)).toBe("1180px");
      const card = await upload.locator(".upload-card").boundingBox();
      const rail = await upload.locator(".upload-aside").boundingBox();
      if (viewport.width > 1200) {
        expect(rail!.width).toBe(320); expect(card!.width).toBeGreaterThan(rail!.width * 1.5);
        expect(rail!.x).toBeGreaterThanOrEqual(card!.x + card!.width + 20);
      } else expect(rail!.y).toBeGreaterThanOrEqual(card!.y + card!.height + 20);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      expect(await upload.locator("button, h1, h2, h3, p, strong").evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.tagName))).toEqual([]);
      await expect.poll(() => upload.locator(".upload-hero img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
      await page.screenshot({ path: `/tmp/studydy-upload/${viewport.width}-${state}.png`, fullPage: true });
    });
  }
}

test("selection, invalid replacements, accessible picker, drag/drop and removal keep one valid file", async ({ page }) => {
  await signedIn(page); await page.goto("/upload");
  const input = page.getByLabel("選擇 PDF 教材", { exact: true });
  const drop = page.locator(".file-drop");
  const chosen = page.locator(".chosen-file");
  const submit = page.locator(".upload-card .full-button");
  await input.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab"); await input.focus();
  expect(await drop.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
  expect(await input.evaluate(element => getComputedStyle(element).display)).not.toBe("none");
  const picker = page.waitForEvent("filechooser"); await drop.click(); await (await picker).setFiles(pdf);
  await expect(chosen).toContainText("1 KiB · 準備上傳"); await expect(submit).toBeEnabled();
  await input.setInputFiles({ ...pdf, name: "replacement.pdf" }); await expect(chosen.locator("strong")).toHaveText("replacement.pdf");
  for (const invalid of [
    { name: "empty.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(0) },
    { name: "not-pdf.txt", mimeType: "text/plain", buffer: Buffer.from("notes") },
  ]) {
    await input.setInputFiles(invalid); await expect(page.getByRole("alert")).toBeVisible();
    await expect(chosen).toHaveCount(0); await expect(submit).toBeDisabled();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAttribute("aria-describedby", "upload-file-error");
    await expect(page.locator("#upload-file-error")).toHaveAttribute("role", "alert");
    await expect(page.locator("#upload-submit-error")).toHaveCount(0);
  }
  const valid = await transfer(page, [{ name: "dropped.pdf", type: "application/pdf" }]);
  await drop.dispatchEvent("dragenter", { dataTransfer: valid }); await expect(drop).toHaveClass(/is-dragging/);
  await drop.dispatchEvent("dragover", { dataTransfer: valid });
  await drop.dispatchEvent("dragleave", { dataTransfer: valid }); await expect(drop).not.toHaveClass(/is-dragging/);
  await drop.dispatchEvent("drop", { dataTransfer: valid }); await expect(chosen.locator("strong")).toHaveText("dropped.pdf");
  await expect(drop).not.toHaveClass(/is-dragging/); await expect(submit).toBeEnabled(); await valid.dispose();
  for (const files of [[{ name: "not-pdf.txt", type: "text/plain" }], [{ name: "a.pdf", type: "application/pdf" }, { name: "b.pdf", type: "application/pdf" }]]) {
    const invalid = await transfer(page, files); await drop.dispatchEvent("drop", { dataTransfer: invalid }); await invalid.dispose();
    await expect(page.getByRole("alert")).toContainText(files.length === 2 ? "一次只能處理一份 PDF" : "不是可用的 PDF");
    await expect(chosen).toHaveCount(0); await expect(submit).toBeDisabled();
    await expect(input).toHaveAttribute("aria-invalid", "true");
    await expect(input).toHaveAttribute("aria-describedby", "upload-file-error");
    await expect(page.locator("#upload-file-error")).toHaveAttribute("role", "alert");
    await expect(page.locator("#upload-submit-error")).toHaveCount(0);
  }
  await input.setInputFiles(pdf); await expect(page.getByRole("alert")).toHaveCount(0);
  await page.getByRole("button", { name: "移除", exact: true }).click();
  await expect(chosen).toHaveCount(0); await expect(submit).toBeDisabled(); expect(await input.inputValue()).toBe("");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("rapid submit creates one material then one bound run and navigates only after both succeed", async ({ page }) => {
  await signedIn(page);
  const requests: { path: string; key: string }[] = [];
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/v1/materials", async route => {
    requests.push({ path: "material", key: route.request().headers()["idempotency-key"] });
    expect(route.request().headers()["content-type"]).toBe("application/pdf");
    expect(decodeURIComponent(route.request().headers()["x-material-name"])).toBe(pdf.name);
    expect(route.request().postDataBuffer()).toEqual(pdf.buffer);
    await pending; await route.fulfill({ status: 201, json: material });
  });
  await page.route("**/v1/material-processing-runs", route => {
    requests.push({ path: "run", key: route.request().headers()["idempotency-key"] });
    expect(route.request().postDataJSON()).toEqual({ schema: "material-processing-create/v1", material_id: materialId, source_artifact_id: artifactId });
    return route.fulfill({ status: 201, json: run });
  });
  await page.goto("/upload"); await page.getByLabel("選擇 PDF 教材", { exact: true }).setInputFiles(pdf);
  await page.locator(".upload-card .full-button").evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect.poll(() => requests.length).toBe(1);
  await expect(page.locator(".upload-card .full-button")).toBeDisabled();
  const ignored = await transfer(page, [{ name: "ignored.txt", type: "text/plain" }]);
  await page.locator(".file-drop").dispatchEvent("drop", { dataTransfer: ignored }); await ignored.dispose();
  await expect(page.locator(".chosen-file strong")).toHaveText(pdf.name);
  release();
  await expect(page).toHaveURL(new RegExp(`/materials/${materialId}/runs/${runId}$`));
  expect(requests.map(request => request.path)).toEqual(["material", "run"]);
  expect(requests[0].key).toMatch(/^[0-9a-f-]{36}$/); expect(requests[1].key).not.toBe(requests[0].key);
});

for (const stage of ["material", "run"] as const) {
  test(`${stage} failure stays on Upload and retry reuses each original idempotency key`, async ({ page }) => {
    await signedIn(page);
    let fail = true;
    const uploads: string[] = []; const runs: string[] = [];
    await page.route("**/v1/materials", route => { uploads.push(route.request().headers()["idempotency-key"]); return fail && stage === "material" ? failure(route) : route.fulfill({ status: 201, json: material }); });
    await page.route("**/v1/material-processing-runs", route => { runs.push(route.request().headers()["idempotency-key"]); return fail && stage === "run" ? failure(route) : route.fulfill({ status: 201, json: run }); });
    await page.goto("/upload"); await page.getByLabel("選擇 PDF 教材", { exact: true }).setInputFiles(pdf);
    const submit = page.locator(".upload-card .full-button");
    await submit.click(); await expect(page.getByRole("alert")).toContainText("資料服務暫時無法使用");
    await expect(page).toHaveURL(/\/upload$/); await expect(submit).toBeEnabled();
    await expect(page.locator(".chosen-file strong")).toHaveText(pdf.name);
    await expect(page.locator(".chosen-file")).toContainText("準備上傳");
    await expect(page.locator(".chosen-file")).not.toContainText("需要修正");
    await expect(page.locator("#upload-submit-error")).toHaveAttribute("role", "alert");
    await expect(page.locator("#upload-file-error")).toHaveCount(0);
    const input = page.getByLabel("選擇 PDF 教材", { exact: true });
    expect(await input.getAttribute("aria-invalid")).toBeNull();
    expect(await input.getAttribute("aria-describedby")).toBeNull();
    if (stage === "material") expect(runs).toHaveLength(0);
    fail = false; await submit.click();
    await expect(page).toHaveURL(new RegExp(`/materials/${materialId}/runs/${runId}$`));
    expect(uploads).toHaveLength(2); expect(uploads[1]).toBe(uploads[0]);
    expect(runs).toHaveLength(stage === "run" ? 2 : 1);
    if (stage === "run") expect(runs[1]).toBe(runs[0]);
  });
}

test("remove and replacement reset both keys without retaining old selection errors", async ({ page }) => {
  await signedIn(page);
  const uploads: string[] = []; const runs: string[] = [];
  await page.route("**/v1/materials", route => { uploads.push(route.request().headers()["idempotency-key"]); return route.fulfill({ status: 201, json: material }); });
  await page.route("**/v1/material-processing-runs", route => { runs.push(route.request().headers()["idempotency-key"]); return failure(route); });
  await page.goto("/upload"); const input = page.getByLabel("選擇 PDF 教材", { exact: true });
  for (let index = 0; index < 3; index++) {
    if (index === 1) {
      await page.getByRole("button", { name: "移除", exact: true }).click();
      await expect(page.locator(".chosen-file")).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.locator(".upload-card .full-button")).toBeDisabled();
      expect(await input.inputValue()).toBe("");
      expect(await input.getAttribute("aria-invalid")).toBeNull();
      expect(await input.getAttribute("aria-describedby")).toBeNull();
    }
    await input.setInputFiles({ ...pdf, name: index === 2 ? "replacement.pdf" : pdf.name });
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator(".chosen-file strong")).toHaveText(index === 2 ? "replacement.pdf" : pdf.name);
    expect(await input.getAttribute("aria-invalid")).toBeNull();
    expect(await input.getAttribute("aria-describedby")).toBeNull();
    await expect(page.locator(".upload-card .full-button")).toBeEnabled();
    await page.locator(".upload-card .full-button").click(); await expect(page.getByRole("alert")).toBeVisible();
  }
  expect(new Set(uploads).size).toBe(3); expect(new Set(runs).size).toBe(3);
  await input.setInputFiles({ name: "invalid.txt", mimeType: "text/plain", buffer: Buffer.from("notes") });
  await expect(page.locator("#upload-submit-error")).toHaveCount(0);
  await expect(page.locator("#upload-file-error")).toBeVisible();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAttribute("aria-describedby", "upload-file-error");
  await expect(page.locator(".chosen-file")).toHaveCount(0);
  await expect(page.locator(".upload-card .full-button")).toBeDisabled();
  await input.setInputFiles(pdf);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.locator(".chosen-file")).toContainText("準備上傳");
  expect(await input.getAttribute("aria-invalid")).toBeNull();
  expect(await input.getAttribute("aria-describedby")).toBeNull();
  await expect(page.locator(".upload-card .full-button")).toBeEnabled();
});

test("task supporting rail stacks before the main upload area becomes cramped", async ({ page }) => {
  await signedIn(page); await page.setViewportSize({ width: 1100, height: 800 }); await page.goto("/upload");
  const card = await page.locator(".upload-card").boundingBox(); const rail = await page.locator(".upload-aside").boundingBox();
  expect(rail!.y).toBeGreaterThan(card!.y + card!.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1100);
});
