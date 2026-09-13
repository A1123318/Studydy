import assert from "node:assert/strict";
import test from "node:test";
import { learningNavigationItems, focusLayout, initialFocusConceptId } from "./knowledge-map.ts";

const view = {
  concepts: ["a", "b", "c", "d"].map(concept_id => ({ concept_id })),
  relations: [
    { relation_id: "ab", source_concept_id: "a", target_concept_id: "b", type: "prerequisite", learner_reason: "A before B" },
    { relation_id: "bc", source_concept_id: "b", target_concept_id: "c", type: "example", learner_reason: "C illustrates B" },
    { relation_id: "cd", source_concept_id: "c", target_concept_id: "d", type: "part_of", learner_reason: "C is part of D" },
  ],
};

test("focus shows the selected concept and only its direct neighbours, preserving direction", () => {
  const original = structuredClone(view);
  const nodes = focusLayout(view, "b");
  assert.deepEqual(new Set(nodes.map(node => node.id)), new Set(["a", "b", "c"]));
  const byId = Object.fromEntries(nodes.map(node => [node.id, node]));
  assert.ok(byId.a.x < byId.b.x && byId.b.x < byId.c.x);
  assert.ok(byId.b.width > byId.a.width);
  assert.equal(byId.a.side, "left");
  assert.equal(byId.c.side, "right");
  assert.deepEqual(view, original);
});

test("bidirectional links don't duplicate a neighbour; isolated concepts remain reachable", () => {
  const bidirectional = { ...view, relations: [...view.relations, { ...view.relations[0], source_concept_id: "b", target_concept_id: "a" }] };
  assert.equal(focusLayout(bidirectional, "b").filter(node => node.id === "a").length, 1);
  assert.deepEqual(focusLayout({ ...view, relations: [] }, "d").map(node => node.id), ["d"]);
});

test("first visit starts with a connected concept without changing the learning path", () => {
  const map = { ...view, initial_learning_path: [{ concept_id: "cover" }, { concept_id: "a" }, { concept_id: "b" }] };
  assert.equal(initialFocusConceptId(map), "b");
  assert.equal(map.initial_learning_path[0].concept_id, "cover");
  assert.equal(initialFocusConceptId({ ...map, relations: [] }), "cover");
});

const navigation = {
  document_tree: { sections: [
    { section_id: "a", title: "Section A", order: 0 },
    { section_id: "b", title: "Section B", order: 1 },
  ] },
  concepts: [
    { concept_id: "a1", section_ids: ["a"] },
    { concept_id: "b1", section_ids: ["b"] },
    { concept_id: "a2", section_ids: ["a"] },
  ],
  initial_learning_path: [
    { position: 3, concept_id: "a2", reason: "document_order" },
    { position: 1, concept_id: "a1", reason: "document_order" },
    { position: 2, concept_id: "b1", reason: "prerequisite" },
  ],
};

test("flat navigation preserves path positions and canonical reasons regardless of sections", () => {
  const original = structuredClone(navigation);
  const items = learningNavigationItems(navigation);
  assert.deepEqual(items.map(item => [item.concept.concept_id, item.step.position]), [["a1", 1], ["b1", 2], ["a2", 3]]);
  assert.equal(items[1].step.reason, "prerequisite");
  assert.equal(items[1].step, navigation.initial_learning_path[2]);
  assert.deepEqual(navigation, original);
});

test("a path can order C before A and B independently of document order", () => {
  const map = { ...navigation, initial_learning_path: [
    { position: 1, concept_id: "a2", reason: "document_order" },
    { position: 2, concept_id: "a1", reason: "document_order" },
    { position: 3, concept_id: "b1", reason: "prerequisite" },
  ] };
  assert.deepEqual(learningNavigationItems(map).map(item => item.concept.concept_id), ["a2", "a1", "b1"]);
});

test("defensive concepts outside the path get no invented position; broken references fail", () => {
  const map = { ...navigation, concepts: [...navigation.concepts, { concept_id: "extra", section_ids: [] }] };
  const other = learningNavigationItems(map).at(-1);
  assert.equal(other.concept.concept_id, "extra");
  assert.equal(other.step, null);
  assert.throws(() => learningNavigationItems({ ...navigation, concepts: [] }));
});
