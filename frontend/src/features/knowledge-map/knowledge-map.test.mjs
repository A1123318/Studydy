import assert from "node:assert/strict";
import test from "node:test";
import { focusLayout, initialFocusConceptId } from "./knowledge-map.ts";

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
