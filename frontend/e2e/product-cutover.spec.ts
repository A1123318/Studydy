import { expect, test, type Page, type Route } from "@playwright/test";
import type { AssessmentRecordView } from "../src/api/contracts";

const materialId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const artifactId = "44444444-4444-4444-8444-444444444444";
const structureRevision = `knowledge-structure:sha256:${"a".repeat(64)}`;
const firstConcept = `concept:sha256:${"b".repeat(64)}`;
const secondConcept = `concept:sha256:${"c".repeat(64)}`;
const firstClaim = `claim:sha256:${"d".repeat(64)}`;
const secondClaim = `claim:sha256:${"e".repeat(64)}`;
const evidenceId = `evidence:sha256:${"1".repeat(64)}`;

function structureView() {
  const concept = (conceptId: string, claimId: string, label: string, page: number) => ({
    concept_id: conceptId,
    label,
    aliases: [],
    section_ids: [`section:sha256:${"2".repeat(64)}`],
    source_pages: [page],
    claims: [{
      claim_id: claimId,
      text: label === "Stack" ? "A stack follows LIFO order." : "An array stores contiguous values.",
      evidence: [{
        evidence_id: label === "Stack" ? evidenceId : `evidence:sha256:${"6".repeat(64)}`,
        page_ref: `page:sha256:${String(page).repeat(64)}`,
        page,
        block_order: 0,
        kind: "paragraph",
        source: "native_text",
        source_locator: { page, block_id: `block:sha256:${String(page).repeat(64)}`, region: [1, 2, 30, 40] },
        quote: label === "Stack" ? "A stack follows LIFO order." : "An array stores contiguous values.",
      }],
    }],
  });
  return {
    schema: "knowledge-structure-view/v2",
    material_id: `material:sha256:${"7".repeat(64)}`,
    knowledge_structure_revision: structureRevision,
    status: { processing: "succeeded", quality: "accepted", decision: "retain", reason_codes: [] },
    document_tree: {
      material_id: `material:sha256:${"7".repeat(64)}`,
      sections: [{ section_id: `section:sha256:${"2".repeat(64)}`, title: "Data structures", order: 0, heading_evidence_id: null, concept_ids: [firstConcept, secondConcept] }],
    },
    concepts: [concept(firstConcept, firstClaim, "Stack", 1), concept(secondConcept, secondClaim, "Array", 2)],
    relations: [{
      relation_id: `relation:sha256:${"8".repeat(64)}`,
      source_concept_id: firstConcept,
      target_concept_id: secondConcept,
      type: "prerequisite",
      learner_reason: "Stack must be learned before Array traversal.",
      evidence_refs: [evidenceId],
      context_refs: [`section:sha256:${"2".repeat(64)}`],
      inference_basis: "dependency",
      confidence: 0.9,
    }],
    initial_learning_path: [
      { position: 1, concept_id: firstConcept, reason: "document_order" },
      { position: 2, concept_id: secondConcept, reason: "prerequisite" },
    ],
    excluded_pages: [],
  };
}

const run = {
  schema: "material-processing-run/v5", cancel_requested_at: null, run_id: runId, material_id: materialId,
  source_artifact_id: artifactId, status: "succeeded", progress_stage: "completed",
  completed_pages: 2, total_pages: 2, error_code: null,
  created_at: "2026-09-05T00:00:00Z", updated_at: "2026-09-05T00:01:00Z", completed_at: "2026-09-05T00:01:00Z",
  output_binding: {
    schema: "material-run-output-binding/v4", knowledge_structure_revision: structureRevision,
    runtime_lock_sha256: "9".repeat(64), page_count: 2, processing: "succeeded",
    quality: "accepted", decision: "retain", reason_codes: [], ocr_calls: 0, semantic_calls: 1,
  },
};

function session(status = "active") {
  return {
    schema: "study-session/v2", study_session_id: sessionId, material_id: materialId,
    knowledge_structure_revision: structureRevision, current_concept_id: firstConcept,
    deferred_concept_ids: [], no_safe_claim_ids: [], status, started_at: "2026-09-05T00:01:00Z",
    completed_at: status === "completed" ? "2026-09-05T00:02:00Z" : null, event_watermark: 0,
  };
}

const progress = {
  schema: "learner-progress/v2", study_session_id: sessionId,
  knowledge_structure_revision: structureRevision, event_watermark: 0,
  current_concept_id: firstConcept, deferred_concept_ids: [],
  concept_states: [
    { concept_id: firstConcept, label: "Stack", status: "not_started", attempts: 0, correct_answers: 0, qualified_correct_items: 0, covered_claim_ids: [], mastered_claim_ids: [], weak_claim_ids: [], latest_is_correct: null },
    { concept_id: secondConcept, label: "Array", status: "not_started", attempts: 0, correct_answers: 0, qualified_correct_items: 0, covered_claim_ids: [], mastered_claim_ids: [], weak_claim_ids: [], latest_is_correct: null },
  ],
  weaknesses: [], next_action: { action: "assess", target_concept_id: firstConcept, target_claim_id: firstClaim, prerequisite_concept_ids: [], reason: "current_concept" },
  guidance_revision: `learner-guidance:sha256:${"f".repeat(64)}`,
};

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, json: body });
}

async function routes(page: Page, view = structureView(), readProgress = () => progress, readRecords: () => AssessmentRecordView[] = () => []) {
  await page.route("**/v1/session", (route) => route.request().method() === "GET" ? json(route, { schema: "learner-identity/v1", learner_id: sessionId }) : route.fulfill({ status: 204 }));
  await page.route("**/v1/session/refresh", (route) => route.fulfill({ status: 204 }));
  await page.route(`**/v1/materials/${materialId}`, route => json(route, {
    schema: "material-library-item/v2", material_id: materialId, source_artifact_id: artifactId,
    display_name: "Data structures.pdf", size_bytes: 100, created_at: run.created_at,
    latest_attempt: run, available_structures: [{ run_id: runId, knowledge_structure_revision: structureRevision,
      created_at: run.created_at, status: "succeeded" }], study_sessions: [],
  }));
  await page.route(`**/v1/material-processing-runs/${runId}`, (route) => json(route, run));
  await page.route("**/v1/materials/*/knowledge-structures/**", (route) => json(route, view));
  await page.route("**/v1/study-sessions", (route) => json(route, session(), 201));
  await page.route("**/v1/materials/*/knowledge-structures/*/study-sessions/*/resume?*", route => {
    const currentProgress = readProgress();
    const records = readRecords();
    const selected = new URL(route.request().url()).searchParams.get("assessment_revision") ?? records[0]?.assessment.assessment_revision ?? null;
    return json(route, { schema: "study-resume/v1", session: { ...session(), event_watermark: currentProgress.event_watermark },
      run_id: runId, source_artifact_id: artifactId, knowledge_structure: view, progress: currentProgress,
      assessments: records, selected_assessment_revision: selected });
  });
}

test("focus, path, and chapter views lead to source-backed learning", async ({ page }) => {
  await routes(page);
  await page.route("**/v1/study-sessions", route => {
    expect(route.request().postDataJSON()).toEqual({ schema: "study-session-create/v2", material_id: materialId,
      knowledge_structure_revision: structureRevision, current_concept_id: firstConcept });
    return json(route, session(), 201);
  });
  await page.context().route(`**/v1/artifacts/${artifactId}`, route => route.fulfill({ contentType: "text/plain", body: "Synthetic source document" }));
  await page.goto(`/materials/${materialId}/runs/${runId}`);
  await page.getByRole("button", { name: "開啟知識地圖", exact: true }).click();
  await expect(page).toHaveURL(`http://127.0.0.1:4173/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
  await expect(page.getByRole("heading", { name: "知識地圖", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "概念地圖" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "學習入口" })).toContainText("準備開始學習「Stack」？");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  const canvas = await page.locator(".focus-graph").boundingBox();
  const navigator = await page.getByRole("navigation", { name: "概念導覽" }).boundingBox();
  const context = await page.getByRole("complementary", { name: "目前焦點資訊" }).boundingBox();
  expect(canvas!.x).toBeGreaterThan(navigator!.x + navigator!.width);
  expect(canvas!.x + canvas!.width).toBeLessThan(context!.x);
  expect(canvas!.width).toBeGreaterThan(context!.width);
  await expect(page.getByRole("button", { name: "開始學習", exact: true })).toBeInViewport();
  const edge = page.locator(".concept-flow-edge.is-prerequisite");
  await edge.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "關係詳情" })).toContainText("Stack must be learned before Array traversal.");
  await expect(page.getByRole("dialog", { name: "關係詳情" }).getByRole("button", { name: /原始教材第 1 頁/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(edge).toBeFocused();
  await page.getByRole("tab", { name: "學習順序" }).click();
  await expect(page.locator(".learning-path li")).toHaveCount(2);
  await expect(page.getByRole("complementary", { name: "Studydy 學習引導" })).toBeVisible();
  await expect(page.locator(".learning-path")).not.toContainText("document_order");
  await page.locator(".learning-path").getByRole("button", { name: /Array/ }).click();
  await expect(page.getByRole("tab", { name: "學習順序" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("dialog", { name: "概念詳情" })).toContainText("An array stores contiguous values.");
  await expect(page.getByRole("dialog").getByRole("button", { name: "從這個概念開始", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "關閉概念詳情" }).click();
  await page.getByRole("tab", { name: "總覽", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Data structures", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "探索這個段落" }).click();
  await expect(page.getByRole("button", { name: /原始教材第 1 頁/ })).toBeVisible();
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: /原始教材第 1 頁/ }).click();
  const source = await popup;
  await expect(source).toHaveURL(`http://127.0.0.1:4173/v1/artifacts/${artifactId}#page=1`);
  await source.close();
  await page.getByRole("button", { name: "從這個概念開始" }).click();
  await expect(page).toHaveURL(new RegExp(`/study-sessions/${sessionId}$`));
});

test("large maps show a readable focus and keep it in view after resizing", async ({ page }) => {
  const view = structureView();
  view.concepts = Array.from({ length: 30 }, (_, index) => ({
    ...view.concepts[0], concept_id: `concept:sha256:${(index + 10).toString(16).padStart(64, "0")}`,
    label: `Concept ${index + 1}`, section_ids: [`section:sha256:${(index + 10).toString(16).padStart(64, "0")}`],
  }));
  view.document_tree.sections = view.concepts.map((concept, index) => ({
    section_id: concept.section_ids[0], title: `Section ${index + 1}`, order: index,
    heading_evidence_id: null, concept_ids: [concept.concept_id],
  }));
  view.relations = [];
  view.initial_learning_path = view.concepts.map((concept, index) => ({ position: index + 1, concept_id: concept.concept_id, reason: "document_order" }));
  await routes(page, view);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
  await page.getByRole("tab", { name: "概念地圖" }).click();
  const graph = page.locator(".focus-graph");
  await expect.poll(async () => (await graph.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(300);
  const viewport = page.locator(".react-flow__viewport");
  await expect(page.locator(".react-flow__node.is-focus")).toBeVisible();
  const transform = await viewport.getAttribute("style");
  const graphBox = (await graph.boundingBox())!;
  await page.mouse.move(graphBox.x + graphBox.width / 2, graphBox.y + graphBox.height / 2);
  await page.mouse.wheel(0, 250);
  await expect(viewport).not.toHaveAttribute("style", transform!);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  const rail = page.locator(".navigator-list");
  const railBox = (await rail.boundingBox())!;
  await page.mouse.move(railBox.x + 50, railBox.y + 100);
  await page.mouse.wheel(0, 250);
  await expect.poll(() => rail.evaluate(element => element.scrollTop)).toBeGreaterThan(100);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.getByRole("navigation", { name: "概念導覽" }).getByRole("button", { name: "Concept 30", exact: true }).click();
  await expect(page.getByRole("button", { name: "教材概念：Concept 30", exact: true })).toHaveClass(/is-focus/);
  await expect.poll(async () => {
    const node = await page.locator(".react-flow__node.is-focus").boundingBox();
    const graph = await page.locator(".focus-graph").boundingBox();
    return !!node && !!graph && node.x >= graph.x && node.x + node.width <= graph.x + graph.width
      && node.y >= graph.y && node.y + node.height <= graph.y + graph.height;
  }).toBe(true);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.getByRole("button", { name: "教材概念：Concept 30", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "概念詳情" })).toBeInViewport();
  await expect.poll(async () => {
    const close = await page.getByRole("button", { name: "關閉概念詳情", exact: true }).boundingBox();
    const tabs = await page.getByRole("tablist", { name: "知識地圖檢視" }).boundingBox();
    return !!close && !!tabs && close.y >= tabs.y + tabs.height;
  }).toBe(true);
  await expect.poll(async () => (await graph.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(300);
  await expect(page.locator(".map-view")).toHaveCSS("overflow-y", "visible");
  await page.setViewportSize({ width: 1100, height: 720 });
  await expect.poll(async () => {
    const node = await page.locator(".react-flow__node.is-focus").boundingBox();
    const graph = await page.locator(".focus-graph").boundingBox();
    return !!node && !!graph && node.width >= 150 && node.x >= graph.x && node.x + node.width <= graph.x + graph.width;
  }).toBe(true);
});

test("StudySession uses source-bound assessment and server feedback", async ({ page }) => {
  const sharedEvidenceView = structureView();
  sharedEvidenceView.concepts[0].claims.push({
    ...sharedEvidenceView.concepts[0].claims[0],
    claim_id: `claim:sha256:${"f".repeat(64)}`,
    text: "Another learning point with the same source page.",
  });
  let guidedClaim = firstClaim;
  const records: AssessmentRecordView[] = [];
  await routes(page, sharedEvidenceView, () => ({
    ...progress, event_watermark: records.filter(record => record.feedback).length,
    next_action: { ...progress.next_action, target_claim_id: guidedClaim },
  }), () => records);
  const requestedClaims: string[] = [];
  const assessmentRevision = `assessment:sha256:${"3".repeat(64)}`;
  const questionId = `question:sha256:${"4".repeat(64)}`;
  const options = ["LIFO", "FIFO", "RANDOM", "PRIORITY"].map((text, index) => ({ option_id: `option:sha256:${String(index + 1).repeat(64)}`, text }));
  await page.route(`**/v1/study-sessions/${sessionId}/assessments`, (route) => {
    requestedClaims.push(route.request().postDataJSON().target_claim_id);
    const assessment = {
    schema: "single-choice-assessment/v2" as const, assessment_revision: requestedClaims.length === 1 ? assessmentRevision : `assessment:sha256:${"6".repeat(64)}`,
    study_session_id: sessionId, knowledge_structure_revision: structureRevision,
    question_id: questionId, target_concept_id: firstConcept, target_claim_id: firstClaim,
    source_evidence_ids: [evidenceId], question_type: "single_choice" as const,
    prompt: "根據教材，Stack 使用哪種順序？", options,
  };
    records.unshift({ assessment, feedback: null, created_at: "2026-09-05T00:02:00Z", can_submit: true });
    return json(route, assessment, 201);
  });
  await page.route(`**/v1/study-sessions/${sessionId}/assessments/${encodeURIComponent(assessmentRevision)}/submissions`, (route) => {
    guidedClaim = sharedEvidenceView.concepts[0].claims[1].claim_id;
    const feedback = {
    schema: "answer-feedback/v2" as const, answer_event_id: "55555555-5555-4555-8555-555555555555",
    study_session_id: sessionId, assessment_revision: assessmentRevision,
    question_id: questionId, selected_option_id: options[0].option_id, is_correct: true,
    rationale: "A stack follows LIFO order.", source_evidence_ids: [evidenceId], event_number: 1,
    created_at: "2026-09-05T00:02:00Z",
  };
    records[0].feedback = feedback;
    records[0].can_submit = false;
    return json(route, feedback, 201);
  });
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}/study-sessions/${sessionId}`);
  await page.getByRole("button", { name: "開始評量" }).click();
  await expect(page.getByRole("heading", { name: "根據教材，Stack 使用哪種順序？" })).toBeVisible();
  await page.getByLabel(/LIFO/).check();
  await page.getByRole("button", { name: "送出答案" }).click();
  await expect(page.getByRole("heading", { name: "答對了" })).toBeVisible();
  await expect(page.locator(".feedback-rationale")).toHaveText("A stack follows LIFO order.");
  await expect(page.locator(".feedback-evidence button")).toHaveCount(1);
  await expect.poll(() => guidedClaim).toBe(sharedEvidenceView.concepts[0].claims[1].claim_id);
  await page.getByRole("button", { name: "取得目前概念的新題目" }).click();
  await expect.poll(() => requestedClaims).toEqual([firstClaim, guidedClaim]);
});

test("mobile map has a modal detail drawer with keyboard focus and source links", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await routes(page);
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
  await page.getByRole("tab", { name: "概念地圖" }).click();
  await page.getByRole("button", { name: "查看概念與來源" }).click();
  const dialog = page.getByRole("dialog", { name: "概念詳情" });
  await expect(dialog).toBeInViewport();
  await expect(dialog.getByRole("button", { name: /原始教材第 1 頁/ })).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.matches(":modal"))).toBe(true);
  await page.keyboard.press("Tab");
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".detail-panel"))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "查看概念與來源" })).toBeFocused();
  await page.locator(".focus-relations summary").click();
  await page.getByRole("list", { name: "直接概念關係", exact: true }).getByRole("button").click();
  await expect(page.getByRole("dialog", { name: "關係詳情" })).toContainText("Stack must be learned before Array traversal.");
});

test("assessment follows the guided Claim when reopening a multi-Claim concept", async ({ page }) => {
  const view = structureView();
  view.concepts[0].claims.push({ ...view.concepts[0].claims[0], claim_id: secondClaim, text: "Second learning point." });
  await routes(page, view, () => ({
    ...progress, next_action: { ...progress.next_action, target_claim_id: secondClaim },
  }));
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}/study-sessions/${sessionId}`);
  await expect(page.locator(`input[name="target-claim"][value="${secondClaim}"]`)).toBeChecked();
  await page.reload();
  await expect(page.locator(`input[name="target-claim"][value="${secondClaim}"]`)).toBeChecked();
});

test("a safe retry replaces old no-safe guidance before answering", async ({ page }) => {
  let unavailable = false;
  let requests = 0;
  const records: AssessmentRecordView[] = [];
  await routes(page, structureView(), () => ({
    ...progress, next_action: unavailable
      ? { ...progress.next_action, action: "defer", target_concept_id: secondConcept, reason: "no_safe_assessment" }
      : progress.next_action,
  }), () => records);
  await page.route(`**/v1/study-sessions/${sessionId}/assessments`, route => {
    requests += 1;
    unavailable = requests === 1;
    if (unavailable) return json(route, {
      schema: "api-error/v1", request_id: materialId, reason_code: "NO_SAFE_ASSESSMENT", retryable: false, message: "Request could not be completed.",
    }, 422);
    const assessment = {
      schema: "single-choice-assessment/v2" as const, assessment_revision: `assessment:sha256:${"3".repeat(64)}`,
      study_session_id: sessionId, knowledge_structure_revision: structureRevision,
      question_id: `question:sha256:${"4".repeat(64)}`, target_concept_id: firstConcept, target_claim_id: firstClaim,
      source_evidence_ids: [evidenceId], question_type: "single_choice" as const, prompt: "Safe retry question",
      options: ["LIFO", "FIFO", "RANDOM", "PRIORITY"].map((text, i) => ({ option_id: `option:sha256:${String(i + 1).repeat(64)}`, text })),
    };
    records.unshift({ assessment, feedback: null, created_at: "2026-09-05T00:02:00Z", can_submit: true });
    return json(route, assessment, 201);
  });
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}/study-sessions/${sessionId}`);
  await page.getByRole("button", { name: "開始評量" }).click();
  await expect(page.getByRole("heading", { name: "改用教材回顧" })).toBeVisible();
  await expect(page.getByRole("button", { name: "暫緩並繼續" })).toBeVisible();
  await page.getByRole("button", { name: "完成本次回顧" }).click();
  await page.getByRole("button", { name: "開始評量" }).click();
  await expect(page.getByRole("heading", { name: "Safe retry question" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "練習目前概念", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "暫緩並繼續" })).toHaveCount(0);
});

test("stale guidance can reload current progress without applying the old target", async ({ page }) => {
  let outdated = true;
  await routes(page, structureView(), () => ({
    ...progress, next_action: outdated
      ? { ...progress.next_action, action: "advance", target_concept_id: secondConcept, target_claim_id: null }
      : progress.next_action,
  }));
  await page.route(`**/v1/study-sessions/${sessionId}/guidance/apply`, route => {
    outdated = false;
    return json(route, {
      schema: "api-error/v1", request_id: materialId, reason_code: "IDEMPOTENCY_CONFLICT", retryable: false, message: "Request could not be completed.",
    }, 409);
  });
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}/study-sessions/${sessionId}`);
  await page.getByRole("button", { name: "繼續學習", exact: true }).click();
  await expect(page.getByRole("heading", { name: "無法開啟本次學習", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "重新讀取", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Stack", exact: true, level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "練習目前概念", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "繼續學習", exact: true })).toHaveCount(0);
});

test("library loading, read failure and empty state retain usable actions", async ({ page }) => {
  await routes(page);
  let release: (() => void) | undefined;
  const ready = new Promise<void>(resolve => { release = resolve; });
  let failRead = true;
  await page.route("**/v1/materials", async route => {
    if (failRead) {
      await ready;
      return json(route, { schema: "api-error/v1", request_id: sessionId, reason_code: "STORAGE_UNAVAILABLE", retryable: true, message: "Request could not be completed." }, 503);
    }
    return json(route, { schema: "material-library/v2", materials: [] });
  });
  await page.goto("/materials");
  await expect(page.getByRole("heading", { name: "正在讀取教材庫", exact: true })).toBeVisible();
  release!();
  await expect(page.getByRole("heading", { name: "無法讀取教材", exact: true })).toBeVisible();
  failRead = false;
  await page.getByRole("button", { name: "重新讀取", exact: true }).click();
  await expect(page.getByRole("heading", { name: "尚未有學習教材", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "上傳第一份教材", exact: true }).click();
  await expect(page).toHaveURL(/\/upload$/);
  await expect(page.locator('input[type="file"]')).toHaveCount(1);
});

test("reopen rejects a run from a different Knowledge Structure revision", async ({ page }) => {
  await routes(page);
  await page.route(`**/v1/materials/${materialId}`, route => json(route, {
    schema: "material-library-item/v2", material_id: materialId, source_artifact_id: artifactId,
    display_name: "Data structures.pdf", size_bytes: 100, created_at: run.created_at,
    latest_attempt: run, available_structures: [{ run_id: runId, knowledge_structure_revision: structureRevision,
      created_at: run.created_at, status: "succeeded" }], study_sessions: [],
  }));
  await page.route(`**/v1/material-processing-runs/${runId}`, route => json(route, {
    ...run, output_binding: { ...run.output_binding, knowledge_structure_revision: `knowledge-structure:sha256:${"7".repeat(64)}` },
  }));
  await page.route("**/v1/materials", route => json(route, { schema: "material-library/v2", materials: [] }));
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
  await expect(page.getByRole("heading", { name: "無法讀取知識地圖", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "開始新的學習", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "返回教材庫", exact: true }).click();
  await expect(page.getByRole("heading", { name: "尚未有學習教材", exact: true })).toBeVisible();
});

test("dashboard shows unavailable counts truthfully and retries its server-backed summary", async ({ page }) => {
  await routes(page);
  let unavailable = true;
  await page.route('**/v1/materials', route => unavailable
    ? json(route, { schema: 'api-error/v1', request_id: sessionId, reason_code: 'STORAGE_UNAVAILABLE', retryable: true, message: 'Request could not be completed.' }, 503)
    : json(route, { schema: 'material-library/v2', materials: [] }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '歡迎回來！', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('資料服務暫時無法使用');
  await expect(page.locator('.dashboard-stat strong')).toHaveText(['—', '—', '—', '—']);
  unavailable = false;
  await page.getByRole('button', { name: '重新讀取', exact: true }).click();
  await expect(page.locator('.dashboard-stat strong')).toHaveText(['0', '0', '0', '0']);
  await page.getByRole('button', { name: '前往我的教材', exact: true }).click();
  await expect(page).toHaveURL(/\/materials$/);
  await expect(page.getByRole('region', { name: '空教材引導' })).toBeVisible();
});

test("map errors can be retried and an empty map has an actionable explanation", async ({ page }) => {
  await routes(page);
  let failed = true;
  const empty = structureView();
  empty.concepts = [];
  empty.relations = [];
  empty.initial_learning_path = [];
  empty.document_tree.sections = [];
  await page.route("**/v1/materials/*/knowledge-structures/**", route => failed
    ? json(route, { schema: "api-error/v1", request_id: materialId, reason_code: "STORAGE_UNAVAILABLE", retryable: true, message: "Request could not be completed." }, 503)
    : json(route, empty));
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
  await expect(page.getByRole("heading", { name: "無法讀取知識地圖", exact: true })).toBeVisible();
  failed = false;
  await page.getByRole("button", { name: "重新讀取", exact: true }).click();
  await expect(page.getByRole("heading", { name: "知識地圖目前是空的", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "查看處理狀態", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${runId}$`));
});

test("parallel relations retain separate labels, paths and details in both directions", async ({ page }) => {
  const view = structureView();
  view.relations = ["prerequisite", "part_of", "application", "example", "contrast"].map((type, index) => ({
    ...view.relations[0], type,
    relation_id: `relation:sha256:${(index + 20).toString(16).padStart(64, "0")}`,
    source_concept_id: index % 2 ? secondConcept : firstConcept,
    target_concept_id: index % 2 ? firstConcept : secondConcept,
    learner_reason: `Distinct grounded explanation for ${type}.`,
  }));
  await routes(page, view);
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
  const assertSeparate = async () => {
    await expect(page.locator(".concept-flow-edge")).toHaveCount(5);
    await expect.poll(() => page.locator(".concept-flow-edge .react-flow__edge-path").evaluateAll((paths) => new Set(paths.map((path) => path.getAttribute("d"))).size)).toBe(5);
    await expect.poll(() => page.locator(".concept-flow-edge .react-flow__edge-textbg").evaluateAll((labels) => {
      const boxes = labels.map((label) => label.getBoundingClientRect());
      return boxes.length === 5 && boxes.every((a, i) => boxes.every((b, j) => i === j || a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top));
    })).toBe(true);
  };
  await assertSeparate();
  const relationList = page.getByRole("list", { name: "直接概念關係" });
  await expect(relationList.getByRole("button", { name: /來自 ←/ })).toHaveCount(2);
  await expect(relationList.getByRole("button", { name: /連向 →/ })).toHaveCount(3);
  for (const relation of view.relations) {
    await page.locator(`.concept-flow-edge.is-${relation.type} .react-flow__edge-textbg`).click();
    await expect(page.getByRole("dialog", { name: "關係詳情" })).toContainText(relation.learner_reason);
    await assertSeparate();
    if (relation.type === "prerequisite") {
      await page.getByRole("dialog").getByRole("button", { name: /目標概念/ }).click();
      await expect(page.getByRole("dialog", { name: "概念詳情" }).getByRole("heading", { name: "Array", exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(page.locator(`.concept-flow-edge.is-${relation.type}`)).toBeFocused();
  }
  await page.getByRole("navigation", { name: "概念導覽" }).getByRole("button", { name: "Array", exact: true }).click();
  await assertSeparate();
  await page.setViewportSize({ width: 900, height: 800 });
  await assertSeparate();
  await page.locator(".concept-flow-edge.is-application").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "關係詳情" })).toContainText("Distinct grounded explanation for application.");
});

test("dense focus fans avoid crossing edges and unrelated cards", async ({ page }) => {
  const view = structureView();
  const focal = view.concepts[0];
  const neighbours = Array.from({ length: 8 }, (_, i) => ({ ...view.concepts[1], concept_id: `concept:sha256:${(i + 40).toString(16).padStart(64, "0")}`, label: `Neighbour ${i + 1}` }));
  view.concepts = [focal, ...neighbours];
  view.document_tree.sections[0].concept_ids = view.concepts.map(node => node.concept_id);
  view.initial_learning_path = view.concepts.map((node, index) => ({ position: index + 1, concept_id: node.concept_id, reason: "document_order" }));
  view.relations = neighbours.flatMap((node, i) => ["example", "application", "part_of"].map((type, j) => ({
    ...view.relations[0], type,
    relation_id: `relation:sha256:${(100 + i * 3 + j).toString(16).padStart(64, "0")}`,
    source_concept_id: i < 4 && j % 2 === 0 ? node.concept_id : focal.concept_id,
    target_concept_id: i < 4 && j % 2 === 0 ? focal.concept_id : node.concept_id,
  })));
  await routes(page, view);
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
  await expect(page.locator(".react-flow__edge-path")).toHaveCount(24);
  await expect.poll(() => page.evaluate(() => {
    const paths = [...document.querySelectorAll<SVGPathElement>(".react-flow__edge-path")];
    const samples = paths.map(path => Array.from({ length: 81 }, (_, i) => {
      const point = path.getPointAtLength(path.getTotalLength() * i / 80);
      return { x: point.x, y: point.y };
    }));
    const cross = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    for (let i = 0; i < samples.length; i++) for (let j = i + 1; j < samples.length; j++) {
      for (let a = 1; a < samples[i].length; a++) for (let b = 1; b < samples[j].length; b++) {
        const p = samples[i][a - 1], q = samples[i][a], r = samples[j][b - 1], s = samples[j][b];
        if (cross(p, q, r) * cross(p, q, s) < -0.0001 && cross(r, s, p) * cross(r, s, q) < -0.0001) return false;
      }
    }
    const cards = [...document.querySelectorAll(".react-flow__node")].map(node => node.getBoundingClientRect());
    return paths.every((path, i) => samples[i].slice(1, -1).every(point => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
      return cards.every(card => screen.x <= card.left + 1 || screen.x >= card.right - 1 || screen.y <= card.top + 1 || screen.y >= card.bottom - 1);
    }));
  })).toBe(true);
});

test("recovered map reads owned progress and continues the same session without creating learning", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await routes(page);
  await page.route(`**/v1/materials/${materialId}`, route => json(route, {
    schema: "material-library-item/v2", material_id: materialId, source_artifact_id: artifactId,
    display_name: "Data structures.pdf", size_bytes: 100, created_at: run.created_at,
    latest_attempt: run, available_structures: [{ run_id: runId, knowledge_structure_revision: structureRevision,
      created_at: run.created_at, status: "succeeded" }], study_sessions: [
      { ...session(), run_id: runId, knowledge_structure_revision: `knowledge-structure:sha256:${"9".repeat(64)}`, started_at: "2026-09-06T00:00:00Z" },
      { ...session(), run_id: runId },
    ],
  }));
  let creates = 0;
  await page.route("**/v1/study-sessions", route => { creates += 1; return json(route, session(), 201); });
  const path = `/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`;
  await page.goto(path);
  await expect(page.getByRole("button", { name: "繼續本次學習", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "繼續本次學習", exact: true })).toBeInViewport();
  await page.screenshot({ path: "/tmp/studydy-map-workspace/1366-resumed.png", fullPage: true });
  await page.reload();
  await expect(page.getByRole("button", { name: "繼續本次學習", exact: true })).toBeEnabled();
  await page.getByRole("navigation", { name: "概念導覽" }).getByRole("button", { name: "Array", exact: true }).click();
  await expect(page.getByRole("region", { name: "學習入口" })).toContainText("從「Array」開始新的學習？");
  await page.getByRole("tab", { name: "學習順序", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Studydy 學習引導" })).toContainText("接著學習「Stack」");
  await page.getByRole("button", { name: "繼續本次學習", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/study-sessions/${sessionId}$`));
  await expect(page.getByRole("button", { name: "開始評量", exact: true })).toBeVisible();
  expect(creates).toBe(0);
});

test("shared shell density keeps standard pages and map workspace bounded", async ({ page }) => {
  await routes(page);
  await page.route("**/v1/materials", route => json(route, { schema: "material-library/v2", materials: [] }));
  const map = `/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`;
  for (const viewport of [{ width: 1536, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    for (const [name, path, heading] of [
      ["home", "/", "歡迎回來！"], ["materials", "/materials", "我的教材"],
      ["upload", "/upload", "上傳教材"], ["study", `${map}/study-sessions/${sessionId}`, "Stack"],
      ["maps", "/knowledge-maps", "知識地圖"],
      ["detail", `/materials/${materialId}`, "教材詳情"],
      ["processing", `/materials/${materialId}/runs/${runId}`, "教材整理完成"],
      ["map", map, "知識地圖"],
    ]) {
      await page.goto(path);
      await expect(page.locator(".app-header")).toBeVisible();
      if (name === "study") await expect(page.locator(".study-session-page")).toBeVisible();
      else await expect(page.getByRole("heading", { name: heading, exact: true }).first()).toBeVisible();
      expect((await page.locator(".app-header").boundingBox())!.height).toBe(name === "map" ? 56 : viewport.width > 900 ? 74 : 72);
      if (name === "map") await expect(page.locator(".app-sidebar")).toHaveCount(0);
      else if (!["home", "materials", "maps", "upload", "processing"].includes(name) && viewport.width > 900) await expect(page.locator(".sidebar-helper")).toBeVisible();
      if (["home", "materials", "maps", "upload", "processing"].includes(name)) await expect(page.locator(".sidebar-helper")).toHaveCount(0);
      const widths: Record<string, string> = { home: "1260px", materials: "1260px", maps: "1260px", detail: "1018px", processing: "1180px", upload: "1180px" };
      if (widths[name]) expect(await page.locator(".app-main > *").first().evaluate(element => getComputedStyle(element).maxWidth)).toBe(widths[name]);
      await expect(page.locator(".task-page")).toHaveCount(["upload", "processing"].includes(name) ? 1 : 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      await page.screenshot({ path: `/tmp/studydy-dashboard/shell-${name}-${viewport.width}.png`, fullPage: true });
    }
  }
});

function workspaceView(count = 52, longNames = false) {
  const view = structureView();
  const seed = view.concepts[0];
  view.concepts = Array.from({ length: count }, (_, index) => ({ ...seed,
    concept_id: `concept:sha256:${(index + 10).toString(16).padStart(64, "0")}`,
    label: `Concept ${index + 1}${longNames && index % 3 === 0 ? " — 時間與資料結構的跨章節概念_" + "LongTechnicalConceptName".repeat(3) : ""}`,
    aliases: index === 29 ? ["target-alias"] : [],
    section_ids: [`section:sha256:${(Math.floor(index / 6) + 10).toString(16).padStart(64, "0")}`],
    claims: [{ ...seed.claims[0], claim_id: `claim:sha256:${(index + 100).toString(16).padStart(64, "0")}`,
      text: index === 29 ? "A searchable unique learning point." : `Learning point ${index + 1}: read the source and explore how these ideas connect.` }],
  }));
  view.document_tree.sections = Array.from({ length: Math.ceil(count / 6) }, (_, index) => ({
    section_id: view.concepts[index * 6].section_ids[0], title: `Section ${index + 1}`, order: index,
    heading_evidence_id: null, concept_ids: view.concepts.slice(index * 6, index * 6 + 6).map(concept => concept.concept_id),
  }));
  view.initial_learning_path = view.concepts.map((concept, index) => ({ position: index + 1, concept_id: concept.concept_id, reason: "document_order" }));
  view.relations = Array.from({ length: count === 52 ? 47 : count - 1 }, (_, index) => ({ ...view.relations[0],
    relation_id: `relation:sha256:${(index + 100).toString(16).padStart(64, "0")}`,
    source_concept_id: view.concepts[index < 8 ? 0 : index].concept_id,
    target_concept_id: view.concepts[index + 1].concept_id,
    learner_reason: `Connection ${index + 1}: the source explains why these concepts belong together in this section.`,
  }));
  return view;
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1536, height: 1024 }, { width: 1366, height: 768 }, { width: 1100, height: 800 }, { width: 390, height: 844 }]) {
  for (const kind of ["small", "large", "long-names"] as const) {
    test(`focus workspace ${kind} at ${viewport.width}px keeps navigation, context and learning accessible`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const view = workspaceView(kind === "small" ? 6 : 52, kind === "long-names");
      await routes(page, view);
      await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
      const navigator = page.getByRole("navigation", { name: "概念導覽" });
      const context = page.getByRole("complementary", { name: "目前焦點資訊" });
      const graph = page.locator(".focus-graph");
      await expect(navigator).toBeVisible();
      await expect(page.getByText("聚焦目前概念", { exact: true })).toHaveCount(0);
      await expect(page.getByText("顯示所有直接關係", { exact: true })).toHaveCount(0);
      await expect(page.locator(".graph-actions")).toHaveCount(0);
      for (const name of ["放大地圖", "縮小地圖", "顯示完整關係圖"]) await expect(graph.getByRole("button", { name, exact: true })).toBeVisible();
      const studyEntry = page.getByRole("region", { name: "學習入口" });
      await expect(studyEntry).toContainText(`準備開始學習「${view.concepts[0].label}」？`);
      await expect(studyEntry.locator("img")).toHaveCount(0);
      await expect(page.locator(".study-guide")).toHaveCount(0);
      await expect(page.getByRole("combobox", { name: "焦點概念" })).toHaveCount(0);
      await expect(graph.locator(".react-flow__node")).toHaveCount(kind === "small" ? 6 : 9);
      await expect(graph.locator(".concept-flow-edge")).toHaveCount(kind === "small" ? 5 : 8);
      await expect(context.getByRole("heading", { name: view.concepts[0].label, exact: true })).toBeVisible();
      if (viewport.width > 900) {
        await expect(page.locator(".focus-relations")).toHaveCount(0);
        await expect(context.getByRole("list", { name: "直接概念關係" }).getByRole("listitem")).toHaveCount(kind === "small" ? 5 : 8);
        await expect(page.getByRole("button", { name: "開始學習", exact: true })).toBeInViewport();
        const graphBox = (await graph.boundingBox())!;
        const contextBox = (await context.boundingBox())!;
        const entryBox = (await studyEntry.boundingBox())!;
        expect(Math.abs(entryBox.x - graphBox.x)).toBeLessThan(3);
        expect(Math.abs(entryBox.x + entryBox.width - contextBox.x - contextBox.width)).toBeLessThan(3);
        if (kind !== "long-names") expect(entryBox.height).toBeLessThanOrEqual(64);
        expect(await studyEntry.evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true);
        if (viewport.width >= 1200) expect(entryBox.x).toBeGreaterThan((await navigator.boundingBox())!.x + (await navigator.boundingBox())!.width);
        expect(graphBox.width).toBeGreaterThan(contextBox.width);
        expect(Math.abs(graphBox.y + graphBox.height - contextBox.y - contextBox.height)).toBeLessThan(3);
        if (kind !== "small") expect(await context.locator(".focus-context-content").evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      } else {
        await expect(graph).toHaveCSS("height", "360px");
        await expect(page.locator(".focus-relations")).not.toHaveAttribute("open", "");
      }
      if (viewport.width < 1200) await navigator.getByRole("button", { name: /概念導覽/ }).click();
      await expect(navigator.locator('[aria-current="true"]')).toBeInViewport();
      if (kind !== "small") expect(await navigator.locator(".navigator-list").evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
      if (viewport.width < 1200 && kind === "large") {
        await expect(navigator.locator(".navigator-list")).toBeInViewport();
        await page.screenshot({ path: `/tmp/studydy-map-workspace/${viewport.width}-navigator.png`, fullPage: true });
      }
      if (viewport.width < 1200) await navigator.getByRole("button", { name: /概念導覽/ }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      await page.screenshot({ path: `/tmp/studydy-map-workspace/${viewport.width}-${kind}-context.png`, fullPage: true });
      const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
      const detailAction = context.getByRole("button", { name: "查看概念與來源", exact: true });
      await detailAction.click();
      const conceptDetail = page.getByRole("dialog", { name: "概念詳情" });
      await expect(conceptDetail).toBeFocused();
      await expect(conceptDetail.locator(".primary-button, .new-study-note")).toHaveCount(0);
      await expect(page.locator(".map-workspace .primary-button")).toHaveCount(1);
      await expect(page.locator(".focus-study-action")).toBeVisible();
      if (viewport.width > 900) await expect(studyEntry.getByRole("button")).toBeInViewport();
      expect(await conceptDetail.evaluate(element => element.matches(":modal"))).toBe(viewport.width <= 900);
      if (viewport.width <= 900) expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(pageHeight);
      expect(await conceptDetail.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect(page.locator(".map-content > .detail-panel")).toHaveCount(0);
      await page.screenshot({ path: `/tmp/studydy-map-workspace/${viewport.width}-${kind}-concept.png`, fullPage: true });
      if (viewport.width <= 900) await page.mouse.click(1, 1); else await page.keyboard.press("Escape");
      await expect(detailAction).toBeFocused();
      if (viewport.width <= 900) await page.locator(".focus-relations summary").click();
      const relation = context.getByRole("list", { name: "直接概念關係" }).getByRole("button").first();
      await relation.click();
      const relationDetail = page.getByRole("dialog", { name: "關係詳情" });
      await expect(relationDetail).toBeFocused();
      await expect(page.locator(".focus-study-action")).toBeVisible();
      if (viewport.width > 900) await expect(studyEntry.getByRole("button")).toBeInViewport();
      await expect(relationDetail).toContainText(view.relations[0].learner_reason);
      await page.screenshot({ path: `/tmp/studydy-map-workspace/${viewport.width}-${kind}-relation.png`, fullPage: true });
      await page.keyboard.press("Escape");
      await expect(relation).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    });
  }
}

for (const width of [1920, 1536, 1366, 1100, 390]) {
  test(`52-concept navigation and search share focus without opening detail at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 1366 ? 768 : width === 1920 ? 1080 : width === 1536 ? 1024 : width === 1100 ? 800 : 844 });
    const view = workspaceView();
    await routes(page, view);
    await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
    const navigator = page.getByRole("navigation", { name: "概念導覽" });
    if (width < 1200) await navigator.getByRole("button", { name: /概念導覽/ }).click();
    const target = navigator.getByRole("button", { name: "Concept 30", exact: true });
    await target.click();
    await expect(target).toHaveAttribute("aria-current", "true");
    await expect(target).toBeFocused();
    await expect(page.locator(".concept-flow-node.is-focus")).toContainText("Concept 30");
    await expect(page.locator(".focus-context-heading")).toContainText("Concept 30");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const inRail = () => target.evaluate(element => {
      const item = element.getBoundingClientRect(), rail = element.closest(".navigator-list")!.getBoundingClientRect();
      return item.top >= rail.top - 1 && item.bottom <= rail.bottom + 1;
    });
    await expect.poll(inRail).toBe(true);
    await navigator.getByRole("button", { name: "Concept 52", exact: true }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(1);
    await expect(page.locator(".concept-flow-edge")).toHaveCount(0);
    if (width <= 900) await page.locator(".focus-relations summary").click();
    await expect(page.locator(".relation-empty")).toContainText("沒有直接連結");
    await navigator.getByRole("button", { name: "Concept 52", exact: true }).focus();
    await page.keyboard.press("Tab");
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest(".focus-graph"))).toBe(true);
    await page.screenshot({ path: `/tmp/studydy-map-workspace/${width}-isolated.png`, fullPage: true });
    await page.getByRole("tab", { name: "總覽", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "搜尋概念或關鍵字" });
    for (const query of ["Concept 30", "target-alias", "searchable unique"]) {
      await search.fill(query); await search.press("ArrowDown"); await page.keyboard.press("Enter");
      await expect(search).toBeFocused();
      await expect(search).toHaveValue("");
      await expect(page.getByRole("tab", { name: "概念地圖", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.locator(".concept-flow-node.is-focus")).toContainText("Concept 30");
      await expect(page.locator(".focus-context-heading")).toContainText("Concept 30");
    }
    if (width < 1200) await navigator.getByRole("button", { name: /概念導覽/ }).click();
    await expect.poll(inRail).toBe(true);
    await expect(target).toHaveAttribute("aria-current", "true");
    await search.fill("Concept"); await search.press("Escape");
    await expect(search).toHaveValue("");
    await expect(page.locator(".map-search-results")).toHaveCount(0);
  });
}

test("Focus graph utilities and graph-node detail preserve framing and opener", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 1024 });
  const view = workspaceView();
  await routes(page, view);
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
  const focal = page.getByRole("button", { name: "教材概念：Concept 1", exact: true });
  await page.getByRole("button", { name: "放大地圖", exact: true }).click();
  const graphBox = (await page.locator(".focus-graph").boundingBox())!;
  await page.mouse.move(graphBox.x + 40, graphBox.y + 40);
  await page.mouse.down();
  await page.mouse.move(graphBox.x + 150, graphBox.y + 120, { steps: 5 });
  await page.mouse.up();
  const zoomed = (await focal.boundingBox())!;
  await page.getByRole("button", { name: "顯示完整關係圖", exact: true }).click();
  await expect.poll(async () => (await focal.boundingBox())!.width).toBeLessThan(zoomed.width);
  await expect.poll(() => page.locator(".focus-graph").evaluate(graph => {
    const bounds = graph.getBoundingClientRect();
    return [...graph.querySelectorAll(".react-flow__node")].every(node => {
      const box = node.getBoundingClientRect();
      return box.left >= bounds.left && box.right <= bounds.right && box.top >= bounds.top && box.bottom <= bounds.bottom;
    });
  })).toBe(true);

  await focal.click();
  await expect(page.getByRole("dialog", { name: "概念詳情" })).toBeFocused();
  await page.getByRole("dialog").locator(".detail-explore summary").click();
  await page.getByRole("dialog").getByRole("button", { name: /Concept 2/, exact: false }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Concept 2", exact: true })).toBeVisible();
  await expect(page.locator('.navigator-list [aria-current="true"]')).toHaveText("Concept 2");
  await page.keyboard.press("Escape");
  await expect(focal).toBeFocused();
  await expect(page.locator(".focus-context-heading")).toContainText("Concept 2");
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1536, height: 1024 }, { width: 1366, height: 768 }, { width: 1100, height: 800 }, { width: 390, height: 844 }]) {
  test(`map progress, keyboard tabs and weak-concept review remain available at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await routes(page, structureView(), () => ({ ...progress, concept_states: progress.concept_states.map((state, index) => index ? state : { ...state, status: "needs_review", weak_claim_ids: [firstClaim] }) }));
    await page.route(`**/v1/materials/${materialId}`, route => json(route, {
      schema: "material-library-item/v2", material_id: materialId, source_artifact_id: artifactId,
      display_name: "Data structures.pdf", size_bytes: 100, created_at: run.created_at, latest_attempt: run,
      available_structures: [{ run_id: runId, knowledge_structure_revision: structureRevision, created_at: run.created_at, status: "succeeded" }],
      study_sessions: [{ ...session(), run_id: runId }],
    }));
    await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
    await expect(page.getByRole("button", { name: "繼續本次學習", exact: true })).toBeEnabled();
    if (viewport.width > 900) await expect(page.getByRole("button", { name: "繼續本次學習", exact: true })).toBeInViewport();
    await expect(page.locator(".focus-context .map-learning-badge")).toHaveText("需要複習");
    await page.screenshot({ path: `/tmp/studydy-map-workspace/${viewport.width}-progress.png`, fullPage: true });
    await page.getByRole("tab", { name: "概念地圖", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "學習順序", exact: true })).toBeFocused();
    await expect(page.locator(".learning-path li")).toHaveCount(2);
    await expect(page.getByRole("complementary", { name: "Studydy 學習引導" })).toBeVisible();
    await expect(page.getByRole("button", { name: "繼續本次學習", exact: true })).toHaveCount(1);
    await expect(page.locator(".focus-study-action")).toHaveCount(0);
    await expect(page.locator(".focus-workspace")).toHaveCount(0);
    await page.keyboard.press("End");
    await expect(page.getByRole("tab", { name: "複習重點", exact: true })).toBeFocused();
    await expect(page.getByRole("complementary", { name: "Studydy 學習引導" })).toBeVisible();
    await expect(page.getByRole("button", { name: "繼續本次學習", exact: true })).toHaveCount(1);
    await expect(page.locator(".review-list")).toContainText("A stack follows LIFO order.");
    const reviewAction = page.getByRole("button", { name: "查看重點", exact: true });
    await reviewAction.click();
    await expect(page.getByRole("dialog", { name: "概念詳情" })).toContainText("Stack");
    await expect(page.getByRole("dialog").getByRole("button", { name: "繼續這個概念", exact: true })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(reviewAction).toBeFocused();
    await page.getByRole("tab", { name: "複習重點", exact: true }).focus();
    await page.keyboard.press("Home");
    await expect(page.getByRole("tab", { name: "概念地圖", exact: true })).toBeFocused();
  });
}

test("map loading and excluded-page/progress notices survive the Focus layout", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const view = structureView();
  view.status = { processing: "partial", quality: "needs_review", decision: "review", reason_codes: ["EXCLUDED_PAGES"] };
  view.excluded_pages = [{ page_ref: `page:sha256:${"3".repeat(64)}`, page: 3, stage: "evidence", reason_code: "NO_USABLE_EVIDENCE" }];
  await routes(page, view);
  await page.route(`**/v1/material-processing-runs/${runId}`, route => json(route, { ...run, status: "partial", completed_pages: 3, total_pages: 3,
    output_binding: { ...run.output_binding, page_count: 3, processing: "partial", quality: "needs_review", decision: "review", reason_codes: ["EXCLUDED_PAGES"] } }));
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/v1/materials/*/knowledge-structures/**", async route => { await ready; return json(route, view); });
  await page.route(`**/v1/materials/${materialId}`, route => json(route, { schema: "api-error/v1", request_id: materialId, reason_code: "STORAGE_UNAVAILABLE", retryable: true, message: "Request could not be completed." }, 503));
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
  await expect(page.getByRole("heading", { name: "正在讀取知識地圖", exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("status").filter({ hasText: "第 3 頁未能整理" })).toBeVisible();
  await expect(page.locator(".partial-banner")).toContainText("暫時無法讀取最近的學習進度");
  await expect(page.getByRole("button", { name: "開始學習", exact: true })).toBeInViewport();
  await page.screenshot({ path: "/tmp/studydy-map-workspace/1366-notices.png", fullPage: true });
  await page.getByRole("tab", { name: "總覽", exact: true }).click();
  await expect(page.getByRole("region", { name: "未能整理的頁面" })).toContainText("第 3 頁未納入概念與練習");
});

test("compact learning entry shares loading, starting and new-study authority with reading tabs", async ({ page }) => {
  const view = structureView();
  await routes(page, view);
  let loaded!: () => void, started!: () => void;
  const readingMaterial = new Promise<void>(resolve => { loaded = resolve; });
  const startingStudy = new Promise<void>(resolve => { started = resolve; });
  let hasHistory = false, completed = false, creates = 0;
  await page.route(`**/v1/materials/${materialId}`, async route => {
    await readingMaterial;
    return json(route, { schema: "material-library-item/v2", material_id: materialId, source_artifact_id: artifactId,
      display_name: "Data structures.pdf", size_bytes: 100, created_at: run.created_at, latest_attempt: run,
      available_structures: [{ run_id: runId, knowledge_structure_revision: structureRevision, created_at: run.created_at, status: "succeeded" }],
      study_sessions: hasHistory ? [{ ...session("completed"), run_id: runId }] : [] });
  });
  await page.route("**/v1/materials/*/knowledge-structures/*/study-sessions/*/resume?*", route => json(route, {
    schema: "study-resume/v1", session: session(completed ? "completed" : "active"), run_id: runId,
    source_artifact_id: artifactId, knowledge_structure: view, progress, assessments: [], selected_assessment_revision: null,
  }));
  await page.route("**/v1/study-sessions", async route => {
    creates++;
    expect(route.request().postDataJSON()).toEqual({ schema: "study-session-create/v2", material_id: materialId,
      knowledge_structure_revision: structureRevision, current_concept_id: firstConcept });
    await startingStudy;
    completed = false;
    return json(route, session(), 201);
  });
  const mapPath = `/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`;
  await page.goto(mapPath);
  const entry = page.getByRole("region", { name: "學習入口" });
  await expect(entry.getByRole("button", { name: "讀取學習進度…", exact: true })).toBeDisabled();
  loaded();
  await expect(entry.getByRole("button", { name: "開始學習", exact: true })).toBeEnabled();
  await entry.getByRole("button", { name: "開始學習", exact: true }).click();
  await expect(entry.getByRole("button", { name: "正在開始…", exact: true })).toBeDisabled();
  await expect.poll(() => creates).toBe(1);
  started();
  await expect(page).toHaveURL(new RegExp(`/study-sessions/${sessionId}$`));
  await expect(page.getByRole("button", { name: "開始評量", exact: true })).toBeVisible();
  hasHistory = true; completed = true;
  await page.goto(mapPath);
  await expect(entry.getByRole("button", { name: "開始新的學習", exact: true })).toBeEnabled();
  for (const name of ["學習順序", "總覽", "複習重點"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    const guide = page.getByRole("complementary", { name: "Studydy 學習引導" });
    await expect(guide).toBeVisible();
    await expect(guide.getByRole("button", { name: "開始新的學習", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "開始新的學習", exact: true })).toHaveCount(1);
    await expect(entry).toHaveCount(0);
  }
  await page.getByRole("button", { name: "開始新的學習", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/study-sessions/${sessionId}$`));
  expect(creates).toBe(2);
});

for (const viewport of [{ width: 1536, height: 1024 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  for (const history of ["none", "same", "different"] as const) {
    test(`Focus study targets the selected concept with ${history} session at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const view = structureView();
      view.concepts[0].label = "指標"; view.concepts[1].label = "陣列";
      view.concepts[0].claims[0].text = view.concepts[0].claims[0].evidence[0].quote = "指標保存記憶體位址。";
      const currentId = history === "same" ? secondConcept : firstConcept;
      const saved = { ...session(), current_concept_id: currentId };
      const savedProgress = { ...progress, current_concept_id: currentId,
        next_action: { ...progress.next_action, target_concept_id: currentId, target_claim_id: history === "same" ? secondClaim : firstClaim } };
      await routes(page, view, () => savedProgress);
      await page.route(`**/v1/materials/${materialId}`, route => json(route, {
        schema: "material-library-item/v2", material_id: materialId, source_artifact_id: artifactId,
        display_name: "Data structures.pdf", size_bytes: 100, created_at: run.created_at, latest_attempt: run,
        available_structures: [{ run_id: runId, knowledge_structure_revision: structureRevision, created_at: run.created_at, status: "succeeded" }],
        study_sessions: history === "none" ? [] : [{ ...saved, run_id: runId }],
      }));
      const newSessionId = "55555555-5555-4555-8555-555555555555";
      const created = { ...session(), study_session_id: newSessionId, current_concept_id: secondConcept };
      const requests: unknown[] = [];
      const writes: string[] = [];
      page.on("request", request => { if (request.url().includes("/v1/study-sessions") && request.method() !== "GET") writes.push(request.method() + " " + new URL(request.url()).pathname); });
      await page.route("**/v1/study-sessions", route => {
        requests.push(route.request().postDataJSON());
        return json(route, created, 201);
      });
      await page.route("**/v1/materials/*/knowledge-structures/*/study-sessions/*/resume?*", route => {
        const isNew = route.request().url().includes(newSessionId);
        return json(route, { schema: "study-resume/v1", session: isNew ? created : saved, run_id: runId,
          source_artifact_id: artifactId, knowledge_structure: view,
          progress: isNew ? { ...savedProgress, study_session_id: newSessionId, current_concept_id: secondConcept,
            next_action: { ...savedProgress.next_action, target_concept_id: secondConcept, target_claim_id: secondClaim } } : savedProgress,
          assessments: [], selected_assessment_revision: null });
      });
      await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
      const entry = page.getByRole("region", { name: "學習入口" });
      await expect(entry.getByRole("button")).toBeEnabled();
      const navigator = page.getByRole("navigation", { name: "概念導覽" });
      if (viewport.width <= 900) await navigator.getByRole("button", { name: /概念導覽/ }).click();
      await navigator.getByRole("button", { name: "陣列", exact: true }).click();
      if (viewport.width <= 900) await navigator.getByRole("button", { name: /概念導覽/ }).click();
      const title = history === "same" ? "接著學習「陣列」" : history === "different" ? "從「陣列」開始新的學習？" : "準備開始學習「陣列」？";
      const label = history === "same" ? "繼續本次學習" : history === "different" ? "開始新的學習" : "開始學習";
      await expect(entry).toContainText(title);
      await expect(entry.getByRole("button", { name: label, exact: true })).toBeEnabled();
      await page.screenshot({ path: `/tmp/studydy-map-study-action/${viewport.width}-${history}.png`, fullPage: true });
      await page.getByRole("button", { name: "教材概念：陣列", exact: true }).click();
      const detail = page.getByRole("dialog", { name: "概念詳情" });
      await expect(detail.getByRole("heading", { name: "陣列", exact: true })).toBeVisible();
      for (const name of ["從這個概念開始", "從這裡開始新學習", "繼續這個概念"]) await expect(detail.getByRole("button", { name, exact: true })).toHaveCount(0);
      await expect(detail.getByText("會建立新的學習紀錄，原有紀錄仍保留。", { exact: true })).toHaveCount(0);
      await expect(page.locator(".map-workspace .primary-button")).toHaveCount(1);
      await expect(page.locator(".focus-study-action")).toContainText(title);
      await page.screenshot({ path: `/tmp/studydy-map-study-action/${viewport.width}-${history}-concept.png`, fullPage: viewport.width > 900 });
      await page.keyboard.press("Escape");
      await expect(entry).toContainText(title);
      if (viewport.width <= 900) await page.locator(".focus-relations summary").click();
      await page.getByRole("list", { name: "直接概念關係" }).getByRole("button").click();
      await expect(page.getByRole("dialog", { name: "關係詳情" })).toBeVisible();
      await expect(page.locator(".focus-study-action")).toContainText(title);
      await page.screenshot({ path: `/tmp/studydy-map-study-action/${viewport.width}-${history}-relation.png`, fullPage: viewport.width > 900 });
      await page.keyboard.press("Escape");
      await entry.getByRole("button", { name: label, exact: true }).scrollIntoViewIfNeeded();
      await expect(entry.getByRole("button", { name: label, exact: true })).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      await entry.getByRole("button", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/study-sessions/${history === "same" ? sessionId : newSessionId}$`));
      await expect(page.getByRole("heading", { name: "陣列", level: 1, exact: true })).toBeVisible();
      expect(requests).toEqual(history === "same" ? [] : [{ schema: "study-session-create/v2", material_id: materialId,
        knowledge_structure_revision: structureRevision, current_concept_id: secondConcept }]);
      expect(writes).toEqual(history === "same" ? [] : ["POST /v1/study-sessions"]);
      expect(saved.current_concept_id).toBe(currentId);
    });
  }
}

for (const viewport of [{ width: 1536, height: 1024 }, { width: 1366, height: 768 }, { width: 390, height: 844 }]) {
  for (const kind of ["many", "none", "parallel", "long"] as const) {
    test(`Concept Detail secondary exploration ${kind} at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport);
      const view = workspaceView(kind === "none" ? 1 : kind === "parallel" ? 6 : 9, kind === "long");
      view.concepts[0].aliases = ["Document alias"];
      if (kind === "parallel") view.relations.push(
        { ...view.relations[0], relation_id: `relation:sha256:${"f".repeat(64)}`, type: "contrast", inference_basis: "comparison", learner_reason: "A different perspective on the same concept." },
        { ...view.relations[0], relation_id: `relation:sha256:${"e".repeat(64)}`, source_concept_id: view.concepts[2].concept_id, target_concept_id: view.concepts[3].concept_id },
      );
      await routes(page, view);
      await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
      const context = page.getByRole("complementary", { name: "目前焦點資訊" });
      if (viewport.width > 900) await expect(context.getByRole("heading", { name: /^直接關係/ })).toHaveText(`直接關係 ${kind === "none" ? 0 : kind === "parallel" ? 6 : 8}`);
      if (kind !== "none") {
        if (viewport.width <= 900) await page.locator(".focus-relations summary").click();
        const relation = context.getByRole("list", { name: "直接概念關係" }).getByRole("button").first();
        await expect(relation).toContainText(view.relations[0].learner_reason);
        await relation.click();
        const relationDetail = page.getByRole("dialog", { name: "關係詳情" });
        await expect(relationDetail).toContainText(view.relations[0].learner_reason);
        await expect(relationDetail.getByRole("button", { name: /原始教材第 1 頁/ })).toBeVisible();
        await page.keyboard.press("Escape");
      }
      await context.getByRole("button", { name: "查看概念與來源", exact: true }).click();
      const detail = page.getByRole("dialog", { name: "概念詳情" });
      const explore = detail.locator(".detail-explore");
      await expect(detail.getByRole("heading", { name: "相關概念", exact: true })).toHaveCount(0);
      await expect(detail.getByRole("heading", { name: "教材重點", exact: true })).toBeVisible();
      await expect(detail.locator(".primary-button")).toHaveCount(0);
      if (kind === "none") await expect(explore).toHaveCount(0);
      else {
        await expect(explore.locator("summary")).toHaveText(`延伸探索${kind === "parallel" ? 5 : 8} 個相關概念`);
        await expect(explore).not.toHaveAttribute("open", "");
        expect(await detail.locator(".page-list").evaluate(element => element.parentElement?.nextElementSibling?.matches(".detail-explore"))).toBe(true);
      }
      await page.screenshot({ path: `/tmp/studydy-detail-explore/${viewport.width}-${kind}-closed.png`, fullPage: viewport.width > 900 });
      if (kind === "none") return;
      const summary = explore.locator("summary");
      await summary.focus(); await page.keyboard.press("Enter");
      await expect(explore).toHaveAttribute("open", "");
      await expect(explore).toContainText("依知識地圖中的直接關係，探索其他概念。");
      await expect(explore).not.toContainText(/連向|來自/);
      await expect(explore).not.toContainText(view.relations[0].learner_reason);
      await expect(explore.locator(".detail-explore-item strong")).toHaveText(view.concepts.slice(1).map(concept => concept.label));
      if (kind === "parallel") {
        const other = explore.getByRole("button", { name: "先備、對照：前往Concept 2", exact: true });
        await expect(other).toHaveCount(1);
        await expect(other.locator("small")).toHaveText("先備、對照");
      }
      expect(await detail.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
      await page.screenshot({ path: `/tmp/studydy-detail-explore/${viewport.width}-${kind}-expanded.png`, fullPage: viewport.width > 900 });
      await summary.focus(); await page.keyboard.press("Space");
      await expect(explore).not.toHaveAttribute("open", "");
      await page.keyboard.press("Enter");
      await detail.evaluate(element => { element.scrollTop = element.scrollHeight; });
      await explore.getByRole("button").last().click();
      const target = view.concepts.at(-1)!;
      await expect(detail.getByRole("heading", { name: target.label, exact: true })).toBeVisible();
      await expect(detail).toBeFocused();
      await expect.poll(() => detail.evaluate(element => element.scrollTop)).toBe(0);
      await expect(detail.locator(".detail-explore")).not.toHaveAttribute("open", "");
      await expect(page.locator('.navigator-list [aria-current="true"]')).toHaveText(target.label);
      await expect(page.locator(".concept-flow-node.is-focus")).toContainText(target.label);
      await page.screenshot({ path: `/tmp/studydy-detail-explore/${viewport.width}-${kind}-navigated.png`, fullPage: viewport.width > 900 });
    });
  }
}

for (const mode of ["學習順序", "總覽", "複習重點"] as const) {
  test(`${mode} keeps shared secondary concept navigation and reading study actions`, async ({ page }) => {
    await routes(page, structureView(), () => ({ ...progress,
      concept_states: progress.concept_states.map((state, index) => index ? state : { ...state, status: "needs_review", weak_claim_ids: [firstClaim] }),
    }));
    await page.route(`**/v1/materials/${materialId}`, route => json(route, {
      schema: "material-library-item/v2", material_id: materialId, source_artifact_id: artifactId,
      display_name: "Data structures.pdf", size_bytes: 100, created_at: run.created_at, latest_attempt: run,
      available_structures: [{ run_id: runId, knowledge_structure_revision: structureRevision, created_at: run.created_at, status: "succeeded" }],
      study_sessions: [{ ...session(), run_id: runId }],
    }));
    await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
    await expect(page.getByRole("button", { name: "繼續本次學習", exact: true })).toBeEnabled();
    await page.getByRole("tab", { name: mode, exact: true }).click();
    if (mode === "學習順序") await page.locator(".learning-path").getByRole("button", { name: /Stack/ }).click();
    else await page.getByRole("button", { name: mode === "總覽" ? "探索這個段落" : "查看重點", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "概念詳情" });
    await expect(detail.getByRole("button", { name: "繼續這個概念", exact: true })).toBeVisible();
    await expect(detail.locator(".detail-explore")).not.toHaveAttribute("open", "");
    await detail.locator(".detail-explore summary").click();
    await detail.getByRole("button", { name: "先備：前往Array", exact: true }).click();
    await expect(detail.getByRole("heading", { name: "Array", exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "從這裡開始新學習", exact: true })).toBeVisible();
    await expect(detail.locator(".detail-explore")).not.toHaveAttribute("open", "");
    await expect(page.getByRole("tab", { name: mode, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("complementary", { name: "Studydy 學習引導" })).toContainText("接著學習「Stack」");
  });
}
