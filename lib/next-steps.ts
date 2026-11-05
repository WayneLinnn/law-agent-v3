export function readNextSteps(proposalKind: string, proposalBody: string) {
  if (proposalKind || !proposalBody) return [];
  try {
    const data = JSON.parse(proposalBody) as { next?: unknown };
    if (!Array.isArray(data.next)) return [];
    return data.next
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 3);
  } catch {
    return [];
  }
}
