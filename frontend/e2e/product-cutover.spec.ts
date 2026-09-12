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
  await page.goto(`/materials/${materialId}/runs/${runId}/knowledge-structures/${encodeURIComponent(structureRevision)}`);
  await expect(page.getByRole("heading", { name: "知識地圖", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "概念地圖" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("complementary", { name: "Studydy 學習引導" })).toContainText("學習順序提供參考");
  await expect(page.locator(".react-flow__node")).toHaveCount(2);
  const canvas = await page.locator(".focus-graph").boundingBox();
  expect(canvas!.x).toBeLessThan(60);
  expect(canvas!.y).toBeLessThan(350);
  expect(canvas!.width).toBeGreaterThan(page.viewportSize()!.width - 100);
  const edge = page.locator(".concept-flow-edge.is-prerequisite");
  await edge.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "關係詳情" })).toContainText("Stack must be learned before Array traversal.");
  await expect(page.getByRole("dialog", { name: "關係詳情" }).getByRole("button", { name: /原始教材第 1 頁/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "學習順序" }).click();
  await expect(page.locator(".learning-path li")).toHaveCount(2);
  await expect(page.locator(".learning-path")).not.toContainText("document_order");
  await page.locator(".learning-path").getByRole("button", { name: /Array/ }).click();
  await expect(page.getByRole("tab", { name: "學習順序" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("dialog", { name: "概念詳情" })).toContainText("An array stores contiguous values.");
  await page.getByRole("button", { name: "關閉概念詳情" }).click();
  await page.getByRole("tab", { name: "總覽", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Data structures", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "探索這個段落" }).click();
  await expect(page.getByRole("button", { name: /原始教材第 1 頁/ })).toBeVisible();
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
  await expect.poll(async () => (await graph.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(560);
  const viewport = page.locator(".react-flow__viewport");
  await expect(page.locator(".react-flow__node.is-focus")).toBeVisible();
  const transform = await viewport.getAttribute("style");
  await page.mouse.move(500, 440);
  await page.mouse.wheel(0, 250);
  await expect(viewport).not.toHaveAttribute("style", transform!);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.mouse.move(10, 440);
  await page.mouse.wheel(0, 250);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  const select = page.getByRole("combobox", { name: "焦點概念" });
  await select.selectOption(view.concepts[29].concept_id);
  await expect(page.getByRole("button", { name: "教材概念：Concept 30", exact: true })).toHaveClass(/is-focus/);
  await expect.poll(async () => {
    const node = await page.locator(".react-flow__node.is-focus").boundingBox();
    const graph = await page.locator(".focus-graph").boundingBox();
    return !!node && !!graph && node.x >= graph.x && node.x + node.width <= graph.x + graph.width
      && node.y >= graph.y && node.y + node.height <= graph.y + graph.height;
  }).toBe(true);
  await expect(page.locator(".react-flow__node")).toHaveCount(1);
  await page.evaluate(() => scrollTo(0, 250));
  await page.getByRole("button", { name: "教材概念：Concept 30", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "概念詳情" })).toBeInViewport();
  await expect.poll(async () => {
    const close = await page.getByRole("button", { name: "關閉概念詳情", exact: true }).boundingBox();
    const tabs = await page.getByRole("tablist", { name: "知識地圖檢視" }).boundingBox();
    return !!close && !!tabs && close.y >= tabs.y + tabs.height;
  }).toBe(true);
  await expect.poll(async () => (await graph.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(560);
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
  await page.getByRole("list", { name: "概念關係", exact: true }).getByRole("button").click();
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
  for (const relation of view.relations) {
    await page.locator(`.concept-flow-edge.is-${relation.type} .react-flow__edge-textbg`).click();
    await expect(page.getByRole("dialog", { name: "關係詳情" })).toContainText(relation.learner_reason);
    await assertSeparate();
    await page.keyboard.press("Escape");
  }
  await page.getByRole("combobox", { name: "焦點概念" }).selectOption(secondConcept);
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
  await page.reload();
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
