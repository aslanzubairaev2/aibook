import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG } from "@/lib/config";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";

export const dynamic = "force-dynamic";
// A book's worth of paragraphs takes several model round trips.
export const maxDuration = 300;

// Paragraphs are translated in groups rather than one call per paragraph: the
// model needs neighbouring context to resolve pronouns and terminology, and
// per-paragraph calls would multiply latency by the paragraph count.
const BATCH_CHARS = 6000;
const MAX_PARAGRAPHS = 2000;
const MAX_OUTPUT_TOKENS = 8192;

function hashParagraph(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function buildPrompt(paragraphs: string[], sourceLang: string, targetLang: string): string {
  return `Translate each numbered passage from ${sourceLang} into ${targetLang}.

Rules:
- Translate meaning, not words. The result must read as natural ${targetLang}, not as a word-for-word trace of the source.
- Say exactly what the source says. Nothing added, nothing omitted, nothing softened or simplified.
- Keep the register: legal stays legal, official stays official, conversational stays conversational.
- Keep names, numbers, dates, amounts and identifiers exactly as they are.
- Translate every passage, including short ones and headings. Never merge or split passages.

Return ONLY valid JSON: {"translations":[{"i":1,"text":"…"},{"i":2,"text":"…"}]}
One entry per passage, with the same "i" it was given. No markdown, nothing outside the JSON.

${paragraphs.map((p, i) => `[${i + 1}] ${p}`).join("\n\n")}`;
}

// POST /api/translate-text
// Body: { paragraphs: string[], sourceLanguage, targetLanguage }
//
// Returns a translation for every paragraph, in order. Paragraphs already in
// the cache are never sent to the model, so re-opening a translated text — or
// opening one someone else already translated — is free.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Войдите, чтобы переводить текст." }, { status: 401 });
  }

  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Access Denied" }, { status: 403 });
  }

  const body = await req.json() as {
    paragraphs?: unknown;
    sourceLanguage?: string;
    targetLanguage?: string;
  };

  const paragraphs = Array.isArray(body.paragraphs)
    ? body.paragraphs.filter((p): p is string => typeof p === "string").slice(0, MAX_PARAGRAPHS)
    : [];
  if (paragraphs.length === 0) {
    return NextResponse.json({ error: "Нечего переводить." }, { status: 400 });
  }

  const sourceLanguage = (body.sourceLanguage ?? "de").trim();
  const targetLanguage = (body.targetLanguage ?? "ru").trim();

  const hashes = paragraphs.map(hashParagraph);
  const translations: (string | null)[] = paragraphs.map(() => null);

  // ── Cache first ────────────────────────────────────────────────────────────
  if (supabaseAdmin) {
    const { data } = await supabaseAdmin
      .from("text_translation_cache")
      .select("source_hash, translated")
      .eq("source_lang", sourceLanguage)
      .eq("target_lang", targetLanguage)
      .in("source_hash", Array.from(new Set(hashes)));

    const cached = new Map((data ?? []).map((row) => [row.source_hash as string, row.translated as string]));
    hashes.forEach((hash, i) => {
      const hit = cached.get(hash);
      if (hit) translations[i] = hit;
    });
  }

  const missing = translations
    .map((value, index) => (value === null ? index : -1))
    .filter((index) => index >= 0);

  if (missing.length === 0) {
    return NextResponse.json({ translations, fromCache: paragraphs.length, translated: 0 });
  }

  // ── Translate what is left, in batches ─────────────────────────────────────
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: AI_CONFIG.model,
    generationConfig: {
      responseMimeType: "application/json",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Reproducing a source, not composing one.
      temperature: 0,
    },
  });

  const batches: number[][] = [];
  let current: number[] = [];
  let currentChars = 0;
  for (const index of missing) {
    const length = paragraphs[index].length;
    if (current.length > 0 && currentChars + length > BATCH_CHARS) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(index);
    currentChars += length;
  }
  if (current.length > 0) batches.push(current);

  const fresh: { hash: string; text: string }[] = [];

  for (const batch of batches) {
    const prompt = buildPrompt(batch.map((i) => paragraphs[i]), sourceLanguage, targetLanguage);
    try {
      const result = await model.generateContent(prompt);
      const parsed = JSON.parse(result.response.text()) as { translations?: { i?: number; text?: string }[] };
      for (const entry of parsed.translations ?? []) {
        const position = Number(entry?.i) - 1;
        const original = batch[position];
        if (original === undefined || typeof entry?.text !== "string") continue;
        translations[original] = entry.text;
        fresh.push({ hash: hashes[original], text: entry.text });
      }
    } catch (err) {
      console.error("translate-text batch failed:", err instanceof Error ? err.message : err);
      // Keep going: a failed batch leaves those paragraphs untranslated rather
      // than throwing away the ones that succeeded.
    }
  }

  // Cache what was produced. Failure here costs nothing but a repeat charge
  // later, so it must not fail the request.
  if (supabaseAdmin && fresh.length > 0) {
    const rows = fresh.map(({ hash, text }) => ({
      source_hash: hash,
      source_lang: sourceLanguage,
      target_lang: targetLanguage,
      translated: text,
    }));
    const { error } = await supabaseAdmin
      .from("text_translation_cache")
      .upsert(rows, { onConflict: "source_hash,source_lang,target_lang", ignoreDuplicates: true });
    if (error) console.error("translate-text cache write:", error.message);
  }

  const done = translations.filter((t) => t !== null).length;
  if (done === 0) {
    return NextResponse.json({ error: "Не удалось перевести текст. Попробуйте ещё раз." }, { status: 502 });
  }

  return NextResponse.json({
    translations,
    fromCache: paragraphs.length - missing.length,
    translated: fresh.length,
  });
}
