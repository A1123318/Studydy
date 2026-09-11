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
  await expect(page.getByRole("heading", { name: "登入您的帳戶" })).toBeVisible();
  await login(page, "learner_test", "Wrong synthetic password");
  await expect(page.getByRole("alert")).toHaveText("帳號或密碼不正確。");
  await login(page, "learner_test");
  await expect(page.getByRole("button", { name: "登出", exact: true })).toBeVisible();
  expect((await (await a.request.get(`${origin}/v1/session`)).json()).learner_id).toBe(learnerId);
  await expect(page.getByRole("heading", { name: "歡迎回來！", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "主要導覽", exact: true })).toBeVisible();
  const header = await page.locator(".app-header").boundingBox();
  const logout = await page.getByRole("button", { name: "登出", exact: true }).boundingBox();
  expect(logout!.width).toBeLessThan(140);
  expect(logout!.y + logout!.height).toBeLessThanOrEqual(header!.y + header!.height);

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
  await expect(otherTab.getByRole("heading", { name: "登入您的帳戶" })).toBeVisible();
  await page.getByRole("button", { name: "再試一次", exact: true }).click();
  await expect(page.getByRole("heading", { name: "登入您的帳戶" })).toBeVisible();
  await otherTab.close();
  expect((await a.request.get(`${origin}/v1/session`)).status()).toBe(401);
  await page.getByRole("link", { name: "立即註冊" }).click();
  await page.getByLabel("帳號名稱", { exact: true }).fill("browser_account_b");
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByLabel("確認密碼", { exact: true }).fill(password);
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
  await freshPage.getByRole("button", { name: "開始新的學習", exact: true }).click();
  await expect(freshPage.getByRole("heading", { name: "登入您的帳戶" })).toBeVisible();
  await expect(freshPage.getByText("Stack", { exact: true })).toHaveCount(0);
  expect((await fresh.request.get(`${origin}/v1/session`)).status()).toBe(401);
  await fresh.close();
});

test("auth views retain the design geometry and validate confirmation before registration", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: '建立新帳戶', exact: true })).toBeVisible();
  await expect(page.locator('.app-header')).toHaveCount(0);
  const card = await page.locator('.auth-card').boundingBox();
  expect(card!.width).toBeGreaterThanOrEqual(700);
  expect(card!.width).toBeLessThanOrEqual(720);
  expect(card!.height).toBeGreaterThanOrEqual(690);
  expect(card!.height).toBeLessThanOrEqual(710);
  expect(Math.abs(card!.x + card!.width / 2 - 768)).toBeLessThan(1);
  await expect.poll(() => page.locator('.auth-mascot').evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  let registrations = 0;
  page.on('request', request => { if (request.url().endsWith('/v1/accounts')) registrations++; });
  await page.getByLabel('帳號名稱', { exact: true }).fill('confirmation_check');
  await page.getByLabel('密碼', { exact: true }).fill(password);
  await page.getByLabel('確認密碼', { exact: true }).fill('Different synthetic password');
  await page.getByRole('button', { name: '顯示密碼', exact: true }).click();
  await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '註冊', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('兩次輸入的密碼不一致');
  expect(registrations).toBe(0);
  await page.reload();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole('heading', { name: '建立新帳戶', exact: true })).toBeVisible();
  await page.getByRole('link', { name: '立即登入', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading', { name: '登入您的帳戶', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});
