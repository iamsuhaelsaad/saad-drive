export function wouldCreateCycleFromAncestors(sourceId, ancestorIds) {
  if (!sourceId) return false;
  return new Set((ancestorIds || []).filter(Boolean)).has(sourceId);
}
