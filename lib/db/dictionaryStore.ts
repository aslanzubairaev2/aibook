// Reading and writing the learner's dictionary.
//
// Entries are keyed by lemma, so photographing the same coursebook page twice
// updates what is there instead of doubling it. An update never blanks a field
// that the new reading happened not to see: a second, blurrier photo must not
// erase the plural form the first one got right.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DictionaryEntryDraft } from "@/lib/ai/buildDictionaryPrompt";

export type DictionaryEntry = {
  id: string;
  headword: string;
  lemma: string;
  language: string;
  translation: string;
  part_of_speech: string;
  gender: string;
  article: string;
  plural: string;
  forms: Record<string, string>;
  cefr: string;
  note: string;
  example: string;
  example_translation: string;
  source: string;
  created_at: string;
};

export const DICTIONARY_COLUMNS =
  "id, headword, lemma, language, translation, part_of_speech, gender, article, plural, forms, cefr, note, example, example_translation, source, created_at";

export type SaveEntriesResult =
  | { ok: true; added: number; updated: number }
  | { ok: false; error: string };

export async function saveDictionaryEntries(
  admin: SupabaseClient,
  userId: string,
  language: string,
  drafts: DictionaryEntryDraft[],
  source: string,
): Promise<SaveEntriesResult> {
  if (drafts.length === 0) return { ok: true, added: 0, updated: 0 };

  const lemmas = drafts.map((d) => d.lemma);
  const { data: existingRows, error: readError } = await admin
    .from("dictionary_entries")
    .select("id, lemma, plural, forms, example, example_translation, note, cefr, translation")
    .eq("user_id", userId)
    .eq("language", language)
    .in("lemma", lemmas);

  if (readError) return { ok: false, error: `Не удалось прочитать словарь: ${readError.message}` };

  const existing = new Map((existingRows ?? []).map((row) => [row.lemma as string, row]));

  const rows = drafts.map((d) => {
    const prior = existing.get(d.lemma) as Record<string, unknown> | undefined;
    // Prefer what this reading found; fall back to what was already known.
    const keep = (next: string, old: unknown) => next || String(old ?? "");
    return {
      user_id: userId,
      language,
      headword: d.headword,
      lemma: d.lemma,
      translation: keep(d.translation, prior?.translation),
      part_of_speech: d.partOfSpeech,
      gender: d.gender,
      article: d.article,
      plural: keep(d.plural, prior?.plural),
      forms: Object.keys(d.forms ?? {}).length > 0 ? d.forms : (prior?.forms ?? {}),
      cefr: keep(d.cefr, prior?.cefr),
      note: keep(d.note ?? "", prior?.note),
      example: keep(d.example ?? "", prior?.example),
      example_translation: keep(d.exampleTranslation ?? "", prior?.example_translation),
      source: source.slice(0, 200),
      updated_at: new Date().toISOString(),
    };
  });

  const { error } = await admin
    .from("dictionary_entries")
    .upsert(rows, { onConflict: "user_id,lemma,language" });

  if (error) return { ok: false, error: `Не удалось сохранить слова: ${error.message}` };

  return { ok: true, added: rows.length - existing.size, updated: existing.size };
}
