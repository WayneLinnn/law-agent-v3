export function materialState(material: {
  readText: string;
  usableText: string;
  textStatus: string;
  stored: boolean;
  note?: string;
}) {
  if (material.usableText.trim() || material.readText.trim()) return material.textStatus;
  if (!material.stored) return "原件没有留下";
  if (material.note?.trim()) return material.note.trim();
  return "还没读。";
}
