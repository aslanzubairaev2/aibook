// Read-only deployment preflight: limit=0 checks columns, never downloads words.
import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";

nextEnv.loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Schema check requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for the target environment.");
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const tables = {
  dictionary_entries: "id,user_id,lemma,language,batch_id,content_type,plural,forms,example,example_translation",
  dictionary_batches: "id,user_id,title,kind,topic,language,word_count,training,description,instruction",
  flashcards: "id,user_id,front,back,source_book_id,selection_type,cefr,repetitions,next_review_at",
  shared_books: "id,owner_user_id,metadata",
  shared_book_chapters: "id,shared_book_id,paragraphs",
};
let failed = false;
for (const [table, columns] of Object.entries(tables)) {
  const { error } = await admin.from(table).select(columns).limit(0).abortSignal(AbortSignal.timeout(15000));
  if (error) {
    failed = true;
    const columnsMentioned = columns.split(",").filter((column) => error.message.includes(column));
    console.error(`${table}: FAIL (${error.code || "connection error"}${columnsMentioned.length ? "; " + columnsMentioned.join(", ") : ""}). Check applied migrations and API schema cache.`);
  } else console.log(`${table}: OK`);
}
process.exitCode = failed ? 1 : 0;
