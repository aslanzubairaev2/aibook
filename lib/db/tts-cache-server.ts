import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { normalizeTtsCacheScope, type TtsCacheScope } from "@/lib/ttsCacheScope";

const BUCKET = "tts-audio";

// The audio lives in Storage only: the table's old audio_base64 column has been
// dropped, and naming it in a select or upsert fails the whole query.
type CacheRow = { storage_path: string | null };

export function cacheVoiceNameCandidates(voiceName: string, legacyVoiceNames: string[] = []): string[] {
  return [voiceName, ...legacyVoiceNames].filter((name, index, names) => name && names.indexOf(name) === index);
}

function storagePath(text: string, lang: string, voiceName: string): string {
  const key = createHash("sha256").update(`${lang}\0${voiceName}\0${text}`).digest("hex");
  return `audio/${key}.bin`;
}

/** Keep special-purpose recordings apart without changing the public schema. */
function scopedVoiceName(voiceName: string, scope: TtsCacheScope): string {
  return scope === "default" ? voiceName : `${scope}:${voiceName}`;
}

function scopedLegacyVoiceNames(voiceNames: string[], scope: TtsCacheScope): string[] {
  return voiceNames.map((name) => scopedVoiceName(name, scope));
}

/** Read a cache entry with the privileged server client only. */
export async function sbGetCachedTtsServer(
  text: string,
  lang: string,
  voiceName: string,
  legacyVoiceNames: string[] = [],
  scope: TtsCacheScope = "default",
): Promise<string | null> {
  if (!supabaseAdmin) return null;

  const safeScope = normalizeTtsCacheScope(scope);
  const currentVoiceName = scopedVoiceName(voiceName, safeScope);
  const candidates = cacheVoiceNameCandidates(
    currentVoiceName,
    scopedLegacyVoiceNames(legacyVoiceNames, safeScope),
  );

  for (const candidate of candidates) {
    const { data, error } = await supabaseAdmin
      .from("ai_tts_cache")
      .select("storage_path")
      .eq("text", text)
      .eq("lang", lang)
      .eq("voice_name", candidate)
      .maybeSingle<CacheRow>();

    if (error) {
      console.error("sbGetCachedTtsServer error:", error.message);
      continue;
    }
    if (!data?.storage_path) continue;

    const { data: object, error: downloadError } = await supabaseAdmin.storage
      .from(BUCKET)
      .download(data.storage_path);
    if (!downloadError && object) {
      return Buffer.from(await object.arrayBuffer()).toString("base64");
    }
    console.warn("TTS Storage read failed:", downloadError?.message ?? "empty object");
  }

  return null;
}

/**
 * Store new audio privately. A row is written only once its audio is safely in
 * Storage — a row pointing at nothing would be a permanent cache miss.
 */
export async function sbSaveCachedTtsServer(
  text: string,
  lang: string,
  voiceName: string,
  audioBase64: string,
  scope: TtsCacheScope = "default",
): Promise<void> {
  if (!supabaseAdmin) return;

  const safeScope = normalizeTtsCacheScope(scope);
  const cacheVoiceName = scopedVoiceName(voiceName, safeScope);
  const path = storagePath(text, lang, cacheVoiceName);
  const bytes = Buffer.from(audioBase64, "base64");
  const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(path, bytes, {
    contentType: "application/octet-stream",
    upsert: true,
  });

  if (uploadError) {
    console.error("TTS Storage upload failed; recording not cached:", uploadError.message);
    return;
  }

  const { error } = await supabaseAdmin
    .from("ai_tts_cache")
    .upsert(
      { text, lang, voice_name: cacheVoiceName, storage_path: path },
      { onConflict: "text,lang,voice_name" },
    );
  if (error) console.error("sbSaveCachedTtsServer error:", error.message);
}

export { BUCKET, storagePath };
