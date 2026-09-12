import { expect, test, type Page } from "@playwright/test";
import type { MaterialLibraryItem, MaterialAttemptView, StudySessionLink } from "../src/api/contracts";

const materialId = "11111111-1111-4111-8111-111111111111";
const publishedRun = "22222222-2222-4222-8222-222222222222";
const latestRun = "33333333-3333-4333-8333-333333333333";
const studyId = "44444444-4444-4444-8444-444444444444";
const revision = `knowledge-structure:sha256:${"a".repeat(64)}`;
const mapPath = `/materials/${materialId}/runs/${publishedRun}/knowledge-structures/${encodeURIComponent(revision)}`;
const base: MaterialLibraryItem = { schema: "material-library-item/v2", material_id: materialId, source_artifact_id: materialId,
  display_name: "資料結構講義.pdf", size_bytes: 1200, created_at: "2026-09-12T00:00:00Z", latest_attempt: null, available_structures: [], study_sessions: [] };
const run: MaterialAttemptView = { cancel_requested_at: null, run_id: latestRun, status: "running", progress_stage: "semantics", completed_pages: 2, total_pages: 8,
  error_code: null, created_at: "2026-09-12T01:00:00Z" };
const published = { run_id: publishedRun, knowledge_structure_revision: revision, status: "succeeded" as const, created_at: "2026-09-12T00:30:00Z" };
const active: StudySessionLink = { study_session_id: studyId, run_id: publishedRun, knowledge_structure_revision: revision,
  status: "active", started_at: "2026-09-12T02:00:00Z", current_concept_id: null };
const states = ["empty", "uploaded", "pending", "running", "failed", "failed-map", "map", "active", "completed", "multiple", "long-name", "loading", "failure"] as const;
type State = typeof states[number];
function material(state: State): MaterialLibraryItem {
  const item = structuredClone(base);
  if (["pending", "running", "failed", "failed-map"].includes(state)) item.latest_attempt = { ...run,
    status: state.startsWith("failed") ? "failed" : state === "pending" ? "pending" : "running",
    progress_stage: state === "pending" ? "queued" : "semantics", error_code: state.startsWith("failed") ? "STORAGE_UNAVAILABLE" : null };
  if (["map", "failed-map", "active", "completed", "long-name"].includes(state)) {
    item.available_structures = [published];
    item.latest_attempt ??= { ...run, status: "succeeded", progress_stage: "completed", completed_pages: 8 };
  }
  if (["active", "completed", "long-name"].includes(state)) item.study_sessions = [{ ...active, status: state === "completed" ? "completed" : "active" }];
  if (state === "long-name") item.display_name = "資料結構與演算法_" + "VeryLongMaterialFilename".repeat(6) + ".pdf";
  return item;
}
function materials(state: State): MaterialLibraryItem[] {
  if (["empty", "loading", "failure"].includes(state)) return [];
  if (state === "multiple") return (["uploaded", "running", "failed", "failed-map", "active", "completed"] as const).map((value, index) => ({
    ...material(value), material_id: `${String(index + 1).padStart(8, "0")}-1111-4111-8111-111111111111`,
    display_name: ["尚未處理的筆記.pdf", "本週課程：遞迴與樹狀結構的概念整理和練習題.pdf", "陣列.pdf", "堆疊講義.pdf", "佇列與練習.pdf", "已完成的學習筆記.pdf"][index],
  }));
  return [material(state)];
}
async function signedIn(page: Page) {
  await page.route("**/v1/session/refresh", route => route.fulfill({ status: 204 }));
  await page.route("**/v1/session", route => route.fulfill({ json: { schema: "learner-identity/v1", learner_id: materialId } }));
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1536, height: 1024 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  for (const state of states) {
    test(`materials collection ${state} at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport); await signedIn(page);
      let fail = state === "failure";
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const items = materials(state);
      await page.route("**/v1/materials", async route => {
        if (state === "loading") await pending;
        if (fail) return route.fulfill({ status: 503, json: { schema: "api-error/v1", request_id: materialId, reason_code: "STORAGE_UNAVAILABLE",
          retryable: true, message: "Request could not be completed." } });
        return route.fulfill({ json: { schema: "material-library/v2", materials: items } });
      });
      await page.goto("/materials");
      const library = page.locator(".material-library.is-collection");
      await expect(library).toBeVisible();
      await expect(library).not.toHaveClass(/is-maps-only/);
      await expect(page.locator(".sidebar-helper")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "教材庫", exact: true })).toHaveAttribute("aria-current", "page");
      const bounds = await library.boundingBox();
      expect(await library.evaluate(element => getComputedStyle(element).maxWidth)).toBe("1260px");
      if (viewport.width >= 1536) expect(bounds!.width).toBeGreaterThan(1018);
      if (state === "loading") await expect(library.locator(".state-view.is-loading")).toHaveAttribute("aria-live", "polite");
      else if (state === "failure") await expect(library.getByRole("alert")).toContainText("無法讀取教材");
      else {
        await expect(library.getByRole("heading", { name: "我的教材", exact: true, level: 1 })).toBeVisible();
        await expect(library.getByRole("button", { name: "重新整理", exact: true })).toHaveCount(0);
        if (state === "empty") {
          await expect(library.locator(".library-header .state-actions")).toHaveCount(0);
          await expect(library.locator(".library-subtitle")).toHaveText("上傳教材後，可在這裡查看處理結果並接續學習。");
          await expect(library.getByRole("heading", { name: "尚未有學習教材", exact: true })).toBeVisible();
          await expect(library.getByRole("button", { name: "上傳教材", exact: true })).toHaveCount(0);
          await expect(library.locator(".primary-button")).toHaveCount(1);
          await expect(library.locator(".library-empty")).toContainText("先上傳第一份 PDF，讓 Studydy 陪你展開學習。");
          if (viewport.width > 600) {
            const empty = await library.locator(".library-empty").boundingBox();
            expect(empty!.height).toBeGreaterThanOrEqual(360); expect(empty!.height).toBeLessThanOrEqual(420);
          }
          await expect.poll(() => library.locator(".library-empty img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
        } else {
          await expect(library.locator(".library-subtitle")).toHaveText(`已保存 ${items.length} 份教材，隨時接續你的學習。`);
          await expect(library.getByRole("button", { name: "上傳教材", exact: true })).toHaveClass("primary-button");
          await expect(library.getByRole("article")).toHaveCount(items.length);
          for (const item of items) {
            const card = library.getByRole("article", { name: item.display_name, exact: true });
            const primary = item.study_sessions[0] ? item.study_sessions[0].status === "completed" ? "查看上次學習" : "接續上次學習"
              : item.available_structures.length ? "開啟知識地圖" : item.latest_attempt ? "查看最新處理" : null;
            await expect(card.locator(".primary-button")).toHaveCount(primary ? 1 : 0);
            if (primary) await expect(card.locator(".primary-button")).toHaveText(primary);
            else await expect(card).toContainText("已上傳，尚未開始處理");
          }
          if (["pending", "running"].includes(state)) await expect(library.getByRole("article")).toContainText("已完成 2 頁／共 8 頁");
          if (state === "failed-map") await expect(library.getByRole("article")).toContainText("先前已發布的知識地圖仍可開啟");
          if (state === "multiple" && viewport.width > 1200) {
            const rows = await library.getByRole("article").evaluateAll(elements => elements.map(element => { const r = element.getBoundingClientRect(); return { top: r.top, height: r.height }; }));
            expect(rows[0].top).toBe(rows[2].top);
            expect(rows[3].top).toBeGreaterThan(rows[0].top);
            expect(new Set(rows.slice(0, 3).map(row => row.height)).size).toBe(1);
          }
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      expect(await library.locator("button, h1, h2, p").evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.tagName))).toEqual([]);
      await page.screenshot({ path: `/tmp/studydy-material-collection/${viewport.width}-${state}.png`, fullPage: true });
      if (state === "loading" || state === "failure") {
        if (state === "failure") {
          const failedAgain = page.waitForResponse(response => response.url().endsWith("/v1/materials") && response.status() === 503);
          await library.getByRole("button", { name: "重新讀取", exact: true }).click(); await failedAgain;
          await expect(library.getByRole("alert")).toContainText("無法讀取教材");
        }
        fail = false; release();
        if (state === "failure") await library.getByRole("button", { name: "重新讀取", exact: true }).click();
        await expect(library.getByRole("heading", { name: "尚未有學習教材", exact: true })).toBeVisible();
        expect((await library.boundingBox())!.width).toBe(bounds!.width);
      }
      if (state === "empty") {
        const upload = library.getByRole("button", { name: "上傳第一份教材", exact: true });
        await upload.focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
        await expect(upload).toBeFocused();
        expect(await upload.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
        await page.keyboard.press("Enter"); await expect(page).toHaveURL(/\/upload$/);
      } else if (!["multiple", "loading", "failure"].includes(state)) {
        const item = items[0];
        const action = library.getByRole("article").locator(".primary-button");
        const expected = item.study_sessions[0] ? `${mapPath}/study-sessions/${studyId}` : item.available_structures.length ? mapPath
          : item.latest_attempt ? `/materials/${materialId}/runs/${latestRun}` : `/materials/${materialId}`;
        if (await action.count()) await action.click(); else await library.getByRole("button", { name: item.display_name, exact: true }).click();
        expect(new URL(page.url()).pathname).toBe(expected);
      }
    });
  }
}

test("materials polling updates pending/running, stops at terminal and cancels on unmount", async ({ page }) => {
  await page.clock.install(); await page.clock.pauseAt(new Date()); await signedIn(page);
  let reads = 0;
  let running = false;
  await page.route("**/v1/materials", route => {
    reads++;
    return route.fulfill({ json: { schema: "material-library/v2", materials: [material(running ? "running" : reads === 1 ? "pending" : reads === 2 ? "running" : "map")] } });
  });
  await page.goto("/materials");
  await expect(page.getByRole("article")).toBeVisible();
  await page.clock.runFor(2999); expect(reads).toBe(1);
  const refresh = page.waitForResponse("**/v1/materials"); await page.clock.runFor(1); await refresh;
  await expect(page.getByRole("article")).toContainText("正在分析完整教材"); expect(reads).toBe(2);
  const terminal = page.waitForResponse("**/v1/materials"); await page.clock.runFor(3000); await terminal;
  await expect(page.getByRole("article").locator(".primary-button")).toHaveText("開啟知識地圖"); expect(reads).toBe(3);
  await page.clock.runFor(9001); expect(reads).toBe(3);
  running = true;
  await page.goto("/materials");
  await expect(page.getByRole("article")).toContainText("正在分析完整教材"); expect(reads).toBe(4);
  await page.getByRole("button", { name: "上傳教材", exact: true }).click();
  await expect(page).toHaveURL(/\/upload$/);
  await page.clock.runFor(9001); expect(reads).toBe(4);
});

test("no-safe studies and unpublished completed runs keep collection-only action priority", async ({ page }) => {
  await signedIn(page);
  let item = { ...material("active"), study_sessions: [{ ...active, status: "no_safe" as const }] } as MaterialLibraryItem;
  await page.route("**/v1/materials", route => route.fulfill({ json: { schema: "material-library/v2", materials: [item] } }));
  await page.route(`**/v1/materials/${materialId}`, route => route.fulfill({ json: item }));
  await page.goto("/materials"); await expect(page.getByRole("article").locator(".primary-button")).toHaveText("接續上次學習");
  for (const status of ["succeeded", "partial"] as const) {
    item = { ...base, latest_attempt: { cancel_requested_at: null, ...run, status, progress_stage: "completed", completed_pages: 8 } };
    await page.goto("/materials"); await expect(page.getByRole("article").locator(".primary-button")).toHaveText("查看最新處理");
    await page.goto(`/materials/${materialId}`);
    await expect(page.locator(".material-library")).not.toHaveClass(/is-collection/);
    await expect(page.locator(".library-header button")).toHaveText(["返回教材庫", "重新整理", "上傳教材"]);
    const reloaded = page.waitForResponse(`**/v1/materials/${materialId}`);
    await page.getByRole("button", { name: "重新整理", exact: true }).click(); await reloaded;
    await expect(page.getByRole("button", { name: "查看最新處理", exact: true })).toHaveClass("secondary-button");
    await expect(page.locator(".sidebar-helper")).toBeVisible();
    await page.screenshot({ path: `/tmp/studydy-material-collection/detail-${status}.png`, fullPage: true });
  }
});
