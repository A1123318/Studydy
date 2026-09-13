import type { KnowledgeStructureView } from "../../api/contracts";

type MapNode = { id: string; side: "center" | "left" | "right"; x: number; y: number; width: number; height: number };

// Section labels separate consecutive steps; they never regroup or reorder the path.
export function learningNavigationGroups(view: KnowledgeStructureView) {
  type Item = { concept: KnowledgeStructureView["concepts"][number]; step: KnowledgeStructureView["initial_learning_path"][number] | null };
  const byId = new Map(view.concepts.map(concept => [concept.concept_id, concept]));
  const sections = [...view.document_tree.sections].sort((a, b) => a.order - b.order);
  const groups: { id: string; sectionId: string | null; title: string; items: Item[] }[] = [];
  const inPath = new Set<string>();
  for (const step of [...view.initial_learning_path].sort((a, b) => a.position - b.position)) {
    const concept = byId.get(step.concept_id)!;
    const section = sections.find(section => concept.section_ids.includes(section.section_id));
    const sectionId = section?.section_id ?? null;
    if (!groups.length || groups.at(-1)!.sectionId !== sectionId) {
      groups.push({ id: `step-${step.position}`, sectionId, title: section?.title ?? "教材概念", items: [] });
    }
    groups.at(-1)!.items.push({ concept, step });
    inPath.add(step.concept_id);
  }
  const other = view.concepts.filter(concept => !inPath.has(concept.concept_id));
  if (other.length) groups.push({ id: "other", sectionId: null, title: "其他概念", items: other.map(concept => ({ concept, step: null })) });
  return groups;
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
