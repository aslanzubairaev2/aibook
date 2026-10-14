import type { DictionaryBatch, DictionaryEntry } from "@/lib/db/dictionaryStore";

export type VerbGroup = {
  key: string;
  title: string;
  createdAt: number;
  verbs: DictionaryEntry[];
  /** Verbs of this pack still waiting for their principal parts — shown inside the pack, not trained yet. */
  pending: DictionaryEntry[];
};

/**
 * Lays the «Глаголы» screen out by pack. A new pack from the tutor shows up as
 * its own pack, exactly as it does under der · die · das — even while its
 * verbs still wait for forms. Only verbs that belong to no pack fall through
 * to the shared «Без форм» backlog, so filling them never mixes packs.
 */
export function groupVerbsByPack(
  verbs: DictionaryEntry[],
  pending: DictionaryEntry[],
  batches: DictionaryBatch[],
): { groups: VerbGroup[]; loosePending: DictionaryEntry[] } {
  const knownBatches = new Set(batches.map((b) => b.id));
  const byBatch = new Map<string, { verbs: DictionaryEntry[]; pending: DictionaryEntry[] }>();
  const slot = (id: string) => {
    let bucket = byBatch.get(id);
    if (!bucket) { bucket = { verbs: [], pending: [] }; byBatch.set(id, bucket); }
    return bucket;
  };
  const loose: DictionaryEntry[] = [];
  const loosePending: DictionaryEntry[] = [];
  for (const v of verbs) {
    if (v.batch_id && knownBatches.has(v.batch_id)) slot(v.batch_id).verbs.push(v);
    else loose.push(v);
  }
  for (const v of pending) {
    if (v.batch_id && knownBatches.has(v.batch_id)) slot(v.batch_id).pending.push(v);
    else loosePending.push(v);
  }

  const groups: VerbGroup[] = [];
  for (const batch of batches) {
    const bucket = byBatch.get(batch.id);
    if (!bucket) continue;
    groups.push({ key: batch.id, title: batch.title, createdAt: Date.parse(batch.created_at) || 0, ...bucket });
  }
  groups.sort((a, b) => b.createdAt - a.createdAt);
  if (loose.length > 0) {
    groups.push({ key: "loose", title: "Без пачки", createdAt: 0, verbs: loose, pending: [] });
  }
  return { groups, loosePending };
}
