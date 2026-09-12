import { expect, test, type Page } from "@playwright/test";
import type { MaterialProcessingRunView, MaterialLibraryItem } from "../src/api/contracts";

const mid = "11111111-1111-4111-8111-111111111111";
const rid = "22222222-2222-4222-8222-222222222222";
const oldRun = "33333333-3333-4333-8333-333333333333";
const revision = `knowledge-structure:sha256:${"a".repeat(64)}`;
const path = `/materials/${mid}/runs/${rid}`;
const time = new Date("2026-09-12T12:00:00Z");
const base: MaterialProcessingRunView = { schema: "material-processing-run/v5", run_id: rid, material_id: mid, source_artifact_id: mid,
  status: "running", progress_stage: "evidence", completed_pages: 3, total_pages: 45, cancel_requested_at: null,
  output_binding: null, error_code: null, created_at: "2026-09-12T11:59:00Z", updated_at: "2026-09-12T11:59:59Z", completed_at: null };
const stopped = (run = base): MaterialProcessingRunView => ({ ...run, status: "cancelled", cancel_requested_at: time.toISOString(), completed_at: time.toISOString(), updated_at: time.toISOString() });
const requested = (run = base): MaterialProcessingRunView => ({ ...run, cancel_requested_at: time.toISOString(), updated_at: time.toISOString() });
async function setup(page: Page) {
  await page.clock.install({ time }); await page.clock.pauseAt(time);
  await page.route("**/v1/session/refresh", route => route.fulfill({ status: 204 }));
  await page.route("**/v1/session", route => route.fulfill({ json: { schema: "learner-identity/v1", learner_id: mid } }));
  await page.route("**/v1/materials", route => route.fulfill({ json: { schema: "material-library/v2", materials: [] } }));
}
async function confirm(page: Page) {
  await page.getByRole("button", { name: "取消處理", exact: true }).click();
  await expect(page.getByRole("heading", { name: "確定要取消這次教材處理嗎？", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "繼續處理", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "確認取消", exact: true }).click();
}

for (const viewport of [{ width: 1536, height: 1024 }, { width: 390, height: 844 }]) {
  test(`pending cancellation requires confirmation and immediately persists terminal at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport); await setup(page);
    let state: MaterialProcessingRunView = { ...base, status: "pending", progress_stage: "queued", completed_pages: 0, total_pages: null };
    let posts = 0;
    await page.route(`**/v1/material-processing-runs/${rid}`, route => route.fulfill({ json: state }));
    await page.route(`**/v1/material-processing-runs/${rid}/cancel`, route => {
      expect(route.request().method()).toBe("POST"); expect(route.request().postData()).toBeNull();
      expect(route.request().headers()["idempotency-key"]).toBeUndefined();
      expect(route.request().headers().origin).toBe(new URL(page.url()).origin);
      posts++; state = stopped(state); return route.fulfill({ json: state });
    });
    page.on("dialog", () => { throw new Error("native confirmation is not allowed"); });
    await page.goto(path);
    await page.getByRole("button", { name: "取消處理", exact: true }).click();
    expect(posts).toBe(0);
    await expect(page.getByRole("button", { name: "繼續處理", exact: true })).toBeFocused();
    if (viewport.width === 1536) await page.screenshot({ path: "/tmp/studydy-cancel/1536-confirm.png", fullPage: true });
    await page.getByRole("button", { name: "繼續處理", exact: true }).click();
    await expect(page.getByRole("button", { name: "取消處理", exact: true })).toBeFocused();
    expect(posts).toBe(0);
    await confirm(page);
    await expect(page.getByRole("heading", { name: "已取消教材處理", exact: true })).toBeVisible();
    await expect(page.locator(".processing-page")).toContainText("已上傳的教材仍保留");
    await expect(page.locator(".processing-page .is-failure")).toHaveCount(0);
    await expect(page.getByRole("progressbar")).toHaveCount(0);
    await page.screenshot({ path: `/tmp/studydy-cancel/${viewport.width}-cancelled.png`, fullPage: true });
    await page.reload();
    await expect(page.getByRole("heading", { name: "已取消教材處理", exact: true })).toBeVisible();
    expect(posts).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
  });
}

for (const stage of ["evidence", "semantics"] as const) {
  test(`${stage} cancellation remains running until a later safe checkpoint`, async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 1024 }); await setup(page);
    let state: MaterialProcessingRunView = { ...base, progress_stage: stage };
    let reads = 0; let posts = 0;
    let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/v1/material-processing-runs/${rid}`, route => { reads++; return route.fulfill({ json: state }); });
    await page.route(`**/v1/material-processing-runs/${rid}/cancel`, async route => {
      posts++; await pending; state = requested(state); await route.fulfill({ json: state });
    });
    await page.goto(path);
    await page.getByRole("button", { name: "取消處理", exact: true }).click();
    await page.getByRole("button", { name: "確認取消", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
    await expect(page.getByText("正在送出取消要求…", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "確認取消", exact: true })).toBeDisabled();
    await expect.poll(() => posts).toBe(1);
    await page.clock.runFor(1500); await expect.poll(() => reads).toBe(2);
    release();
    await expect(page.getByRole("heading", { name: "正在取消處理", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "取消處理", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "已取消教材處理", exact: true })).toHaveCount(0);
    await page.screenshot({ path: `/tmp/studydy-cancel/1536-${stage}-requested.png`, fullPage: true });
    await page.reload();
    await expect(page.getByRole("heading", { name: "正在取消處理", exact: true })).toBeVisible();
    state = stopped(state);
    await page.clock.runFor(1500);
    await expect(page.getByRole("heading", { name: "已取消教材處理", exact: true })).toBeVisible();
    expect(posts).toBe(1);
  });
}

test("mobile inline confirmation wraps and keeps native keyboard controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await setup(page);
  await page.route(`**/v1/material-processing-runs/${rid}`, route => route.fulfill({ json: base }));
  await page.goto(path); await page.getByRole("button", { name: "取消處理", exact: true }).click();
  await expect(page.getByRole("button", { name: "繼續處理", exact: true })).toBeFocused();
  await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "確認取消", exact: true })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: "/tmp/studydy-cancel/390-confirm.png", fullPage: true });
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "取消處理", exact: true })).toBeFocused();
});

test("publishing wins the race without reporting a failed cancellation", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 }); await setup(page);
  let state = base; let reads = 0;
  await page.route(`**/v1/material-processing-runs/${rid}`, route => { reads++; return route.fulfill({ json: state }); });
  await page.route(`**/v1/material-processing-runs/${rid}/cancel`, route => { state = { ...base, progress_stage: "publishing", completed_pages: 45 }; return route.fulfill({ json: state }); });
  await page.goto(path); await confirm(page);
  await expect(page.getByText("已進入知識地圖發布階段，這個階段無法再取消。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "取消處理", exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: "/tmp/studydy-cancel/1536-too-late.png", fullPage: true });
  await page.clock.runFor(1500); await expect.poll(() => reads).toBe(2);
  await page.reload(); await expect(page.getByRole("button", { name: "取消處理", exact: true })).toHaveCount(0);
});

test("cancel API failure preserves processing and allows retry while GET polling continues", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 }); await setup(page);
  let fail = true; let reads = 0;
  await page.route(`**/v1/material-processing-runs/${rid}`, route => { reads++; return route.fulfill({ json: base }); });
  await page.route(`**/v1/material-processing-runs/${rid}/cancel`, route => fail
    ? route.fulfill({ status: 503, json: { schema: "api-error/v1", request_id: mid, reason_code: "STORAGE_UNAVAILABLE", retryable: true, message: "Request could not be completed." } })
    : route.fulfill({ json: requested() }));
  await page.goto(path); await confirm(page);
  await expect(page.getByRole("heading", { name: "正在分析教材", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("無法送出取消要求");
  await expect(page.getByRole("button", { name: "確認取消", exact: true })).toBeEnabled();
  await page.screenshot({ path: "/tmp/studydy-cancel/1536-api-error.png", fullPage: true });
  await page.clock.runFor(1500); await expect.poll(() => reads).toBe(2);
  fail = false; await page.getByRole("button", { name: "確認取消", exact: true }).click();
  await expect(page.getByRole("heading", { name: "正在取消處理", exact: true })).toBeVisible();
});

test("late GET cannot erase accepted cancellation and late POST cannot erase terminal cancellation", async ({ page }) => {
  await setup(page);
  let reads = 0; let releaseGet!: () => void; const oldGet = new Promise<void>(resolve => { releaseGet = resolve; });
  let state = base;
  await page.route(`**/v1/material-processing-runs/${rid}`, async route => {
    reads++; const snapshot = state;
    if (reads === 2) await oldGet;
    await route.fulfill({ json: snapshot });
  });
  await page.route(`**/v1/material-processing-runs/${rid}/cancel`, route => { state = requested(); return route.fulfill({ json: state }); });
  await page.goto(path); await expect(page.getByRole("button", { name: "取消處理", exact: true })).toBeVisible();
  await page.clock.runFor(1500); await expect.poll(() => reads).toBe(2);
  await confirm(page); await expect(page.getByRole("heading", { name: "正在取消處理", exact: true })).toBeVisible();
  const settled = page.waitForResponse(response => response.request().method() === "GET" && response.url().endsWith(rid));
  releaseGet(); await settled;
  await expect(page.getByRole("heading", { name: "正在取消處理", exact: true })).toBeVisible();
  state = stopped(); await page.clock.runFor(1500);
  await expect(page.getByRole("heading", { name: "已取消教材處理", exact: true })).toBeVisible();
  await page.unroute(`**/v1/material-processing-runs/${rid}/cancel`);
  let releasePost!: () => void; const oldPost = new Promise<void>(resolve => { releasePost = resolve; });
  state = base;
  await page.route(`**/v1/material-processing-runs/${rid}/cancel`, async route => { state = stopped(); await oldPost; await route.fulfill({ json: requested() }); });
  await page.reload(); await confirm(page); await page.clock.runFor(1500);
  await expect(page.getByRole("heading", { name: "已取消教材處理", exact: true })).toBeVisible();
  const postSettled = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/cancel"));
  releasePost(); await postSettled;
  await expect(page.getByRole("heading", { name: "已取消教材處理", exact: true })).toBeVisible();
});

test("library shows cancelling/cancelled latest attempt while preserving the older map link", async ({ page }) => {
  await setup(page);
  let latest = requested();
  let hasOldMap = true;
  await page.route("**/v1/materials", route => {
    const item: MaterialLibraryItem = { schema: "material-library-item/v2", material_id: mid, source_artifact_id: mid,
      display_name: "保留的教材.pdf", size_bytes: 1000, created_at: base.created_at,
      latest_attempt: { run_id: rid, status: latest.status, progress_stage: latest.progress_stage, completed_pages: latest.completed_pages,
        total_pages: latest.total_pages, created_at: latest.created_at, error_code: null, cancel_requested_at: latest.cancel_requested_at },
      available_structures: hasOldMap ? [{ run_id: oldRun, knowledge_structure_revision: revision, created_at: base.created_at, status: "succeeded" }] : [], study_sessions: [] };
    return route.fulfill({ json: { schema: "material-library/v2", materials: [item] } });
  });
  await page.goto("/materials"); await expect(page.getByRole("article")).toContainText("最新處理：正在取消處理");
  latest = stopped(); await page.clock.runFor(3000);
  await expect(page.getByRole("article")).toContainText("最新處理：已取消處理");
  await expect(page.getByRole("article")).not.toContainText("處理失敗");
  await page.getByRole("button", { name: "開啟知識地圖", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe(`/materials/${mid}/runs/${oldRun}/knowledge-structures/${encodeURIComponent(revision)}`);
  hasOldMap = false;
  await page.route(`**/v1/material-processing-runs/${rid}`, route => route.fulfill({ json: latest }));
  await page.goto("/materials");
  const latestAction = page.getByRole("button", { name: "查看最新處理", exact: true });
  await expect(latestAction).toHaveClass(/primary-button/);
  await latestAction.click();
  await expect(page.getByRole("heading", { name: "已取消教材處理", exact: true })).toBeVisible();
});

test("persisted GET cancellation takes precedence over a late POST transport failure", async ({ page }) => {
  await setup(page);
  let state = base; let release!: () => void; const response = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/v1/material-processing-runs/${rid}`, route => route.fulfill({ json: state }));
  await page.route(`**/v1/material-processing-runs/${rid}/cancel`, async route => {
    state = requested(); await response;
    await route.fulfill({ status: 503, json: { schema: "api-error/v1", request_id: mid, reason_code: "STORAGE_UNAVAILABLE", retryable: true, message: "Request could not be completed." } });
  });
  await page.goto(path); await confirm(page); await page.clock.runFor(1500);
  await expect(page.getByRole("heading", { name: "正在取消處理", exact: true })).toBeVisible();
  const settled = page.waitForResponse(response => response.url().endsWith("/cancel")); release(); await settled;
  await expect(page.getByText("正在送出取消要求…", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "正在取消處理", exact: true })).toBeVisible();
});
