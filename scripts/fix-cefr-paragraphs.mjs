// One-off normalization for already-seeded UniversalCEFR texts.
//
// The old splitCefrText() in app/api/books/seed/route.ts split source texts on
// every "\n", but the HuggingFace texts are hard-wrapped mid-sentence, so one
// sentence ended up as two reader "paragraphs" (breaking TTS, selection,
// translation and AI context in the reader). This script re-merges stored
// paragraphs with the same heuristic the fixed seeder now uses: a paragraph
// boundary is kept only where the text ends a sentence.
//
// Usage:
//   node scripts/fix-cefr-paragraphs.mjs           # dry run, prints what would change
//   node scripts/fix-cefr-paragraphs.mjs --apply   # writes changes (backs up first)
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv(file) {
  const env = {};
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

const env = loadEnv(resolve(root, ".env.local"));
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
const apply = process.argv.includes("--apply");

// Keep in sync with SENTENCE_END_RE / splitCefrText in app/api/books/seed/route.ts.
const SENTENCE_END_RE = /[.!?…:][)"“”„«»'"]*$/u;

function mergeWrappedParagraphs(paragraphs) {
  const out = [];
  let current = "";
  for (const raw of paragraphs) {
    const p = raw.trim();
    if (!p) continue;
    current = current ? `${current} ${p}` : p;
    if (SENTENCE_END_RE.test(p)) {
      out.push(current);
      current = "";
    }
  }
  if (current) out.push(current);
  return out;
}

function rechunkLong(paragraphs) {
  const result = [];
  for (const block of paragraphs) {
    if (block.length <= 320) { result.push(block); continue; }
    const sentences = block.match(/[^.!?]+[.!?]+[)"“”„«»'"]*|[^.!?]+$/gu) ?? [block];
    let current = "";
    for (const s of sentences) {
      if ((current + s).length > 320 && current) { result.push(current.trim()); current = ""; }
      current += s;
    }
    if (current.trim()) result.push(current.trim());
  }
  return result;
}

const { data: books, error: booksErr } = await supabase
  .from("shared_books")
  .select("id, title, language, cefr_level")
  .eq("source_type", "universal_cefr");
if (booksErr) { console.error("Failed to list books:", booksErr.message); process.exit(1); }

console.log(`Found ${books.length} universal_cefr books.`);

const changes = [];
for (const book of books) {
  const { data: chapters, error: chErr } = await supabase
    .from("shared_book_chapters")
    .select("id, chapter_index, paragraphs")
    .eq("shared_book_id", book.id);
  if (chErr) { console.error(`  ${book.title}: ${chErr.message}`); continue; }

  for (const ch of chapters ?? []) {
    const before = ch.paragraphs ?? [];
    const after = rechunkLong(mergeWrappedParagraphs(before));
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    changes.push({ book, chapter: ch, before, after });
  }
}

console.log(`${changes.length} chapters need normalization.`);
for (const c of changes.slice(0, 5)) {
  console.log(`\n--- ${c.book.title} (${c.book.language} ${c.book.cefr_level}): ${c.before.length} -> ${c.after.length} paragraphs`);
  console.log(`  first merged paragraph: ${c.after.find((p) => !c.before.includes(p))?.slice(0, 120) ?? "(none)"}`);
}

if (!apply) {
  console.log("\nDry run only. Re-run with --apply to write changes.");
  process.exit(0);
}

// Backup affected rows before writing.
mkdirSync(resolve(root, "scratch"), { recursive: true });
const backupPath = resolve(root, "scratch", `cefr-paragraphs-backup-${Date.now()}.json`);
writeFileSync(backupPath, JSON.stringify(changes.map((c) => ({
  chapter_id: c.chapter.id,
  book_id: c.book.id,
  title: c.book.title,
  paragraphs: c.before,
})), null, 2), "utf8");
console.log(`\nBackup written to ${backupPath}`);

let updated = 0;
for (const c of changes) {
  const { error: upErr } = await supabase
    .from("shared_book_chapters")
    .update({ paragraphs: c.after, plain_text: c.after.join("\n"), char_count: c.after.join("").length })
    .eq("id", c.chapter.id);
  if (upErr) { console.error(`  FAILED ${c.book.title}: ${upErr.message}`); continue; }
  updated++;
}
console.log(`Updated ${updated}/${changes.length} chapters.`);
