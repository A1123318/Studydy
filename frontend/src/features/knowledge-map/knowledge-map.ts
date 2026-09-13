import type { KnowledgeStructureView } from "../../api/contracts";

type MapNode = { id: string; side: "center" | "left" | "right"; x: number; y: number; width: number; height: number };

// Browse each concept once, under its first section in the document's own order.
export function conceptNavigationGroups(view: KnowledgeStructureView) {
  const groups = [...view.document_tree.sections].sort((a, b) => a.order - b.order)
    .map(section => ({ id: section.section_id, title: section.title, concepts: [] as KnowledgeStructureView["concepts"] }));
  const sectionIndex = new Map(groups.map((group, index) => [group.id, index]));
  const other = { id: "ungrouped", title: "其他概念", concepts: [] as KnowledgeStructureView["concepts"] };
  for (const concept of view.concepts) {
    const indices = concept.section_ids.flatMap(id => sectionIndex.has(id) ? [sectionIndex.get(id)!] : []);
    (indices.length ? groups[Math.min(...indices)] : other).concepts.push(concept);
  }
  return [...groups, other].filter(group => group.concepts.length > 0);
}

// A local view of canonical relations; document hierarchy and learning order stay intact.
export function focusLayout(view: KnowledgeStructureView, selectedId: string): MapNode[] {
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const relation of view.relations) {
    if (relation.target_concept_id === selectedId && relation.source_concept_id !== selectedId) incoming.add(relation.source_concept_id);
    if (relation.source_concept_id === selectedId && relation.target_concept_id !== selectedId) {
      outgoing.add(relation.target_concept_id);
    }
  }
  for (const id of incoming) outgoing.delete(id);
  const column = (ids: Set<string>, x: number, side: "left" | "right"): MapNode[] => [...ids].map((id, index) => ({
    id, side, x, y: (index - (ids.size - 1) / 2) * 168, width: 220, height: 148,
  }));

  return [
    { id: selectedId, side: "center", x: 400, y: -24, width: 300, height: 192 },
    ...column(incoming, 0, "left"), ...column(outgoing, 880, "right"),

  ];
}

export function initialFocusConceptId(view: KnowledgeStructureView): string {
  const neighbours = new Map<string, Set<string>>();
  for (const relation of view.relations) {
    if (relation.source_concept_id === relation.target_concept_id) continue;
    for (const [id, other] of [[relation.source_concept_id, relation.target_concept_id], [relation.target_concept_id, relation.source_concept_id]]) {
      if (!neighbours.has(id)) neighbours.set(id, new Set());
      neighbours.get(id)!.add(other);
    }
  }
  // Prefer the earliest concept that connects several ideas, without changing the path.
  return view.initial_learning_path.find((step) => (neighbours.get(step.concept_id)?.size ?? 0) > 1)?.concept_id
    ?? view.initial_learning_path.find((step) => neighbours.has(step.concept_id))?.concept_id
    ?? view.initial_learning_path[0]?.concept_id ?? view.concepts[0]?.concept_id ?? "";
}
