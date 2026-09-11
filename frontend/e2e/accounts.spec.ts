import { expect, test, type Page } from "@playwright/test";

const password = "Synthetic test password 42";
const learnerId = process.env.STUDYDY_E2E_ACCOUNT_LEARNER!;
const materialId = process.env.STUDYDY_E2E_ACCOUNT_MATERIAL!;
const runId = process.env.STUDYDY_E2E_ACCOUNT_RUN!;
const revision = process.env.STUDYDY_E2E_ACCOUNT_REVISION!;
const artifactId = process.env.STUDYDY_E2E_ACCOUNT_ARTIFACT!;
const mapPath = `/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(revision)}`;
const origin = "http://127.0.0.1:4173";

test.skip(!learnerId, "Requires the local account API/DB fixture");

async function login(page: Page, username: string, suppliedPassword = password) {
  await page.getByLabel("帳號名稱", { exact: true }).fill(username);
  await page.getByLabel("密碼", { exact: true }).fill(suppliedPassword);
  await page.getByRole("button", { name: "登入", exact: true }).click();
}

test("real accounts survive new browser profiles; logout and back never reveal another owner", async ({ browser }) => {
  const a = await browser.newContext();
  const page = await a.newPage();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "登入 Studydy" })).toBeVisible();
  await login(page, "learner_test", "Wrong synthetic password");
  await expect(page.getByRole("alert")).toHaveText("帳號或密碼不正確。");
  await login(page, "learner_test");
  await expect(page.getByRole("button", { name: "登出", exact: true })).toBeVisible();
  expect((await (await a.request.get(`${origin}/v1/session`)).json()).learner_id).toBe(learnerId);
  await page.goto(mapPath);
  await expect(page.getByRole("button", { name: "教材概念：Stack", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "教材概念：Stack", exact: true })).toBeVisible();
  const otherTab = await a.newPage();
  await otherTab.goto(mapPath);
  await expect(otherTab.getByRole("button", { name: "教材概念：Stack", exact: true })).toBeVisible();
  // 只為登出失敗注入一次 transport response，重試仍使用真 API 撤銷。
  await page.route("**/v1/session", route => route.fulfill({ status: 503, json: {
    schema: "api-error/v1", request_id: learnerId, reason_code: "STORAGE_UNAVAILABLE",
    retryable: true, message: "Request could not be completed.",
  } }), { times: 1 });
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page.getByText(/登出尚未完成/)).toBeVisible();
  await expect(page.getByText("Stack", { exact: true })).toHaveCount(0);
  await expect(otherTab.getByRole("heading", { name: "登入 Studydy" })).toBeVisible();
  await page.getByRole("button", { name: "再試一次", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登入 Studydy" })).toBeVisible();
  await otherTab.close();
  expect((await a.request.get(`${origin}/v1/session`)).status()).toBe(401);
  await page.getByRole("button", { name: "建立新帳號" }).click();
  await page.getByLabel("帳號名稱", { exact: true }).fill("browser_account_b");
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "註冊", exact: true }).click();
  await expect(page.getByRole("button", { name: "登出", exact: true })).toBeVisible();
  const bId = (await (await a.request.get(`${origin}/v1/session`)).json()).learner_id;
  expect(bId).not.toBe(learnerId);
  await page.goBack();
  await expect(page.getByText("Stack", { exact: true })).toHaveCount(0);
  await page.goto(mapPath);
  await expect(page.getByText("Stack", { exact: true })).toHaveCount(0);
  expect((await a.request.get(`${origin}/v1/artifacts/${artifactId}`)).status()).toBe(404);
  expect((await a.request.get(`${origin}/v1/material-processing-runs/${runId}`)).status()).toBe(404);
  await a.close();

  // 獨立 profile 重新輸入帳密，沒有複製 cookie 或 localStorage。
  const fresh = await browser.newContext();
  const freshPage = await fresh.newPage();
  await freshPage.goto("/");
  await login(freshPage, "learner_test");
  await expect(freshPage.getByRole("button", { name: "登出", exact: true })).toBeVisible();
  expect((await (await fresh.request.get(`${origin}/v1/session`)).json()).learner_id).toBe(learnerId);
  await freshPage.goto(mapPath);
  await expect(freshPage.getByRole("button", { name: "教材概念：Stack", exact: true })).toBeVisible();
  expect((await fresh.request.get(`${origin}/v1/artifacts/${artifactId}`)).status()).toBe(200);
  await fresh.request.delete(`${origin}/v1/session`, { headers: { Origin: origin } });
  await freshPage.getByRole("button", { name: "開始本次學習", exact: true }).click();
  await expect(freshPage.getByRole("heading", { name: "登入 Studydy" })).toBeVisible();
  await expect(freshPage.getByText("Stack", { exact: true })).toHaveCount(0);
  expect((await fresh.request.get(`${origin}/v1/session`)).status()).toBe(401);
  await fresh.close();
});
