import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { normalizeTtsCacheScope, type TtsCacheScope } from "@/lib/ttsCacheScope";

const BUCKET = "tts-audio";

type CacheRow = { audio_base64: string | null; storage_path: string | null };

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
      .select("audio_base64, storage_path")
      .eq("text", text)
      .eq("lang", lang)
      .eq("voice_name", candidate)
      .maybeSingle<CacheRow>();

    if (error || !data) continue;

    if (data.storage_path) {
      const { data: object, error: downloadError } = await supabaseAdmin.storage
        .from(BUCKET)
        .download(data.storage_path);
      if (!downloadError && object) {
        return Buffer.from(await object.arrayBuffer()).toString("base64");
      }
      console.warn("TTS Storage read failed; trying legacy Base64:", downloadError?.message ?? "empty object");
    }

    // Keep old rows readable while migration is staged. This path is server-only.
    if (data.audio_base64) return data.audio_base64;
  }

  return null;
}

/**
 * Store new audio privately. Legacy Base64 is kept only when Storage upload
 * fails, so a transient Storage problem never makes a generated recording
 * disappear. The old column is retained for rollback and staged migration.
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

  const payload: {
    text: string;
    lang: string;
    voice_name: string;
    audio_base64: string;
    storage_path?: string;
  } = uploadError
    ? { text, lang, voice_name: cacheVoiceName, audio_base64: audioBase64 }
    : { text, lang, voice_name: cacheVoiceName, audio_base64: "", storage_path: path };

  if (uploadError) {
    console.error("TTS Storage upload failed; retaining legacy Base64:", uploadError.message);
  }

  const { error } = await supabaseAdmin
    .from("ai_tts_cache")
    .upsert(payload, { onConflict: "text,lang,voice_name" });
  if (error) console.error("sbSaveCachedTtsServer error:", error.message);
}

export { BUCKET, storagePath };
