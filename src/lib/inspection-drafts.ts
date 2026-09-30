export type InspectionDraft = {
  item_id: string;
  zone_id: string | null;
  status: 'pass' | 'issue' | 'na';
  notes: string | null;
  photo_urls: string[];
};
/** Only restore known cards and well-formed values; browser storage is untrusted. */
export function readInspectionDrafts(raw: string | null, cards: ReadonlyArray<{ cardKey: string; itemId: string; zoneId: string | null }>): Map<string, InspectionDraft> {
  const restored = new Map<string, InspectionDraft>();
  try {
    const data = JSON.parse(raw || 'null');
    if (data?.version !== 1 || !Array.isArray(data.entries)) return restored;
    for (const entry of data.entries) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [key, value] = entry;
      const card = cards.find((c) => c.cardKey === key);
      if (!card || !value || value.item_id !== card.itemId || value.zone_id !== card.zoneId) continue;
      if (!['pass', 'issue', 'na'].includes(value.status)) continue;
      if (value.notes !== null && typeof value.notes !== 'string') continue;
      if (!Array.isArray(value.photo_urls) || !value.photo_urls.every((url: unknown) => typeof url === 'string' && /^https:\/\//.test(url))) continue;
      restored.set(key, { item_id: value.item_id, zone_id: value.zone_id, status: value.status, notes: value.notes, photo_urls: value.photo_urls });
    }
  } catch { /* Corrupt or unavailable storage cannot prevent an inspection. */ }
  return restored;
}
