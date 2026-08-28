import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

const args = new Set(process.argv.slice(2));
const dryRun = !args.has("--apply");
const limitArgIndex = process.argv.indexOf("--limit");
const limitArg = limitArgIndex >= 0 ? process.argv[limitArgIndex + 1] : undefined;
const requestedLimit = Number(limitArg ?? process.env.TTS_MIGRATION_LIMIT ?? "10");
const limit = Number.isInteger(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 25) : 10;
const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

function pathFor(row) {
  const key = createHash("sha256").update(`${row.lang}\0${row.voice_name}\0${row.text}`).digest("hex");
  return `audio/${key}.bin`;
}

const { data: rows, error } = await supabase
  .from("ai_tts_cache")
  .select("id,text,lang,voice_name,audio_base64,storage_path")
  .not("audio_base64", "is", null)
  .neq("audio_base64", "")
  .is("storage_path", null)
  .order("created_at", { ascending: true })
  .limit(limit);
if (error) throw error;

console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "apply", limit, candidates: rows?.length ?? 0 }));
if (dryRun) process.exit(0);

let migrated = 0;
for (const row of rows ?? []) {
  const path = pathFor(row);
  const bytes = Buffer.from(row.audio_base64, "base64");
  const uploaded = await supabase.storage.from("tts-audio").upload(path, bytes, {
    contentType: "application/octet-stream",
    upsert: false,
  });
  if (uploaded.error && !/already exists/i.test(uploaded.error.message)) throw uploaded.error;

  // Keep audio_base64 intact during this staged transfer. A later cleanup is a
  // separate, explicitly approved operation after Storage has been validated.
  const updated = await supabase.from("ai_tts_cache").update({ storage_path: path }).eq("id", row.id);
  if (updated.error) throw updated.error;
  migrated += 1;
}
console.log(JSON.stringify({ migrated, legacyDeleted: 0, legacyPreserved: migrated }));
