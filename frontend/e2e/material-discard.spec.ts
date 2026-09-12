import { expect, test, type Page } from "@playwright/test";
import type { MaterialLibraryItem } from "../src/api/contracts";

const id = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const revision = `knowledge-structure:sha256:${"a".repeat(64)}`;
const created = "2026-09-12T12:00:00Z";
const longName = "傳錯的教材_" + "VeryLongUnbrokenMaterialFilename".repeat(4) + ".pdf";
function item(index: number, state: "no-run" | "failed" | "cancelled" | "running" | "pending" | "succeeded" | "partial", map = false, study = false): MaterialLibraryItem {
  const success = state === "succeeded" || state === "partial";
  return { schema: "material-library-item/v2", material_id: id(index), source_artifact_id: id(index+100), display_name: state === "failed" ? longName : `${state}.pdf`, size_bytes: 1024, created_at: created,
    latest_attempt: state === "no-run" ? null : { run_id: id(index+200), status: state,
      progress_stage: success ? "completed" : state === "pending" ? "queued" : "semantics", completed_pages: success ? 4 : 0, total_pages: state === "pending" ? null : 4,
      error_code: state === "failed" ? "NO_USABLE_EVIDENCE" : null, cancel_requested_at: state === "cancelled" ? created : null, created_at: created },
    available_structures: map ? [{ run_id: id(index+300), knowledge_structure_revision: revision, created_at: created, status: state === "partial" ? "partial" : "succeeded" }] : [],
    study_sessions: study ? [{ study_session_id: id(index+400), run_id: id(index+300), knowledge_structure_revision: revision, status: "active", current_concept_id: null, started_at: created }] : [] };
}
async function setup(page: Page) {
  await page.clock.install({ time: new Date(created) }); await page.clock.pauseAt(new Date(created));
  await page.route("**/v1/session/refresh", route => route.fulfill({ status: 204 }));
  await page.route("**/v1/session", route => route.fulfill({ json: { schema: "learner-identity/v1", learner_id: id(900) } }));
}

for (const viewport of [{ width: 1536, height: 1024 }, { width: 390, height: 844 }]) {
  for (const state of ["no-run", "failed", "cancelled"] as const) {
    test(`${state} card confirms removal and updates count without reload at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport); await setup(page);
      const target = item(1, state);
      let items = [target, item(2, "succeeded", true), item(3, "partial", true)];
      let deletes = 0; let release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; });
      await page.route("**/v1/materials", route => route.fulfill({ json: { schema: "material-library/v2", materials: items } }));
      await page.route(`**/v1/materials/${target.material_id}`, async route => {
        expect(route.request().method()).toBe("DELETE"); deletes++; await pending;
        items = items.filter(saved => saved.material_id !== target.material_id);
        await route.fulfill({ status: 202, json: { schema: "material-discard/v1", material_id: target.material_id, state: "removed" } });
      });
      await page.goto("/materials");
      const card = page.getByRole("article", { name: target.display_name, exact: true });
      await expect(page.locator(".library-subtitle")).toContainText("3 份教材");
      await card.getByRole("button", { name: "移除教材", exact: true }).click();
      expect(deletes).toBe(0);
      await expect(card.getByRole("button", { name: "保留教材", exact: true })).toBeFocused();
      await card.getByRole("button", { name: "保留教材", exact: true }).click();
      await expect(card.getByRole("button", { name: "移除教材", exact: true })).toBeFocused();
      await card.getByRole("button", { name: "移除教材", exact: true }).click();
      await page.keyboard.press("Tab"); await expect(card.getByRole("button", { name: "確認移除", exact: true })).toBeFocused();
      await page.screenshot({ path: `/tmp/studydy-discard/${viewport.width}-${state}-card-confirm.png`, fullPage: true });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      await page.keyboard.press("Escape");
      await expect(card.getByRole("button", { name: "移除教材", exact: true })).toBeFocused();
      await card.getByRole("button", { name: "移除教材", exact: true }).click();
      await card.getByRole("button", { name: "確認移除", exact: true }).evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
      await expect(card.getByRole("button", { name: "確認移除", exact: true })).toBeDisabled();
      await expect(card.getByText("正在移除…", { exact: true })).toBeVisible();
      await expect.poll(() => deletes).toBe(1);
      release();
      await expect(card).toHaveCount(0);
      await expect(page.locator(".library-subtitle")).toContainText("2 份教材");
      await expect(page.getByRole("article")).toHaveCount(2);
      expect(deletes).toBe(1);
    });
  }
}

test("library protects all maps/sessions and keeps active runs on the processing route", async ({ page }) => {
  await setup(page);
  const items = [item(1, "no-run"), item(2, "failed"), item(3, "cancelled"), item(4, "succeeded", true), item(5, "partial", true), item(6, "failed", true), item(7, "running"), item(8, "pending"), item(9, "cancelled", true, true)];
  await page.route("**/v1/materials", route => route.fulfill({ json: { schema: "material-library/v2", materials: items } }));
  await page.goto("/materials");
  for (let index = 0; index < items.length; index++) {
    const card = page.getByRole("article").nth(index);
    await expect(card.getByRole("button", { name: "移除教材", exact: true })).toHaveCount(index < 3 ? 1 : 0);
  }
  await page.getByRole("article").nth(5).getByRole("button", { name: "開啟知識地圖", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe(`/materials/${id(6)}/runs/${id(306)}/knowledge-structures/${encodeURIComponent(revision)}`);
  await page.goto("/materials");
  await page.getByRole("article").nth(8).getByRole("button", { name: "接續上次學習", exact: true }).click();
  expect(new URL(page.url()).pathname).toContain(`/study-sessions/${id(409)}`);
  await page.goto("/materials");
  await page.getByRole("article").nth(6).getByRole("button", { name: "查看最新處理", exact: true }).click();
  expect(new URL(page.url()).pathname).toBe(`/materials/${id(7)}/runs/${id(207)}`);
});

test("failed removal preserves the card and supports retry with a safe error", async ({ page }) => {
  await setup(page);
  const target = item(1, "failed"); let fail = true; let present = true;
  await page.route("**/v1/materials", route => route.fulfill({ json: { schema: "material-library/v2", materials: present ? [target] : [] } }));
  await page.route(`**/v1/materials/${target.material_id}`, route => {
    if (fail) return route.fulfill({ status: 503, json: { schema: "api-error/v1", request_id: id(999), reason_code: "STORAGE_UNAVAILABLE", retryable: true, message: "Request could not be completed." } });
    present = false; return route.fulfill({ status: 202, json: { schema: "material-discard/v1", material_id: target.material_id, state: "removed" } });
  });
  await page.goto("/materials");
  const card = page.getByRole("article");
  await card.getByRole("button", { name: "移除教材", exact: true }).click();
  await card.getByRole("button", { name: "確認移除", exact: true }).click();
  await expect(card).toBeVisible(); await expect(card.getByRole("alert")).toContainText("無法移除教材");
  await expect(card.getByRole("button", { name: "確認移除", exact: true })).toBeEnabled();
  fail = false; await card.getByRole("button", { name: "確認移除", exact: true }).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "尚未有學習教材", exact: true })).toBeVisible();
});

test("accepted card removal keeps polling even when latest attempt is already terminal", async ({ page }) => {
  await setup(page);
  const target = item(1, "cancelled"); let present = true; let reads = 0;
  await page.route("**/v1/materials", route => {
    reads++; return route.fulfill({ json: { schema: "material-library/v2", materials: present ? [target] : [] } });
  });
  await page.route(`**/v1/materials/${target.material_id}`, route => route.fulfill({ status: 202,
    json: { schema: "material-discard/v1", material_id: target.material_id, state: "removing" } }));
  await page.goto("/materials");
  await page.getByRole("button", { name: "移除教材", exact: true }).click();
  await page.getByRole("button", { name: "確認移除", exact: true }).click();
  await expect(page.getByText("正在移除…", { exact: true })).toBeVisible();
  await expect.poll(() => reads).toBe(2);
  await page.clock.runFor(3000); await expect.poll(() => reads).toBe(3);
  present = false; await page.clock.runFor(3000);
  await expect(page.getByRole("article")).toHaveCount(0);
});
