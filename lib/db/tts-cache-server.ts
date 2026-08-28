import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/db/supabase-admin";

const BUCKET = "tts-audio";

type CacheRow = { audio_base64: string | null; storage_path: string | null };

function storagePath(text: string, lang: string, voiceName: string): string {
  const key = createHash("sha256").update(`${lang}\0${voiceName}\0${text}`).digest("hex");
  return `audio/${key}.bin`;
}

/** Read a cache entry with the privileged server client only. */
export async function sbGetCachedTtsServer(
  text: string,
  lang: string,
  voiceName: string,
): Promise<string | null> {
  if (!supabaseAdmin) return null;

  const { data, error } = await supabaseAdmin
    .from("ai_tts_cache")
    .select("audio_base64, storage_path")
    .eq("text", text)
    .eq("lang", lang)
    .eq("voice_name", voiceName)
    .maybeSingle<CacheRow>();

  if (error || !data) return null;

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
  return data.audio_base64 || null;
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
): Promise<void> {
  if (!supabaseAdmin) return;

  const path = storagePath(text, lang, voiceName);
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
    ? { text, lang, voice_name: voiceName, audio_base64: audioBase64 }
    : { text, lang, voice_name: voiceName, audio_base64: "", storage_path: path };

  if (uploadError) {
    console.error("TTS Storage upload failed; retaining legacy Base64:", uploadError.message);
  }

  const { error } = await supabaseAdmin
    .from("ai_tts_cache")
    .upsert(payload, { onConflict: "text,lang,voice_name" });
  if (error) console.error("sbSaveCachedTtsServer error:", error.message);
}

export { BUCKET, storagePath };
