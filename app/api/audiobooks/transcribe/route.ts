import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { normalizeSegments } from "@/lib/audio/transcribe";
import type { AudiobookTranscript } from "@/lib/types";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 120; // Allow up to 120s for full chapter transcription via Files API

// gemini-3.5-transcribe wants a BCP-47 locale, the rest of the app only
// tracks a bare 2-letter code — map the languages the catalog offers.
const LANGUAGE_CODE_MAP: Record<string, string> = {
  de: "de-DE",
  en: "en-US",
  fr: "fr-FR",
  es: "es-ES",
  ru: "ru-RU",
  it: "it-IT",
};

function toLanguageCode(language: string): string {
  return LANGUAGE_CODE_MAP[language] || language;
}

/** "1.200s" / "1s" -> 1.2 / 1 */
function parseOffsetSeconds(offset: unknown): number {
  if (typeof offset !== "string") return 0;
  const n = parseFloat(offset.replace(/s$/, ""));
  return Number.isFinite(n) ? n : 0;
}

type WordAnnotation = {
  type?: string;
  text?: string;
  start_offset?: string;
  end_offset?: string;
};

/**
 * gemini-3.5-transcribe returns one flat list of word_info annotations, not
 * pre-grouped sentences — segment boundaries are ours to draw. Splitting on
 * sentence-ending punctuation keeps the read-along view's per-line chunks
 * roughly matching how the rest of the app already paragraphs text.
 */
function buildSegmentsFromWordAnnotations(annotations: WordAnnotation[]): unknown[] {
  const words = annotations
    .filter((a) => a.type === "word_info" && typeof a.text === "string" && a.text.trim())
    .map((a) => ({
      word: a.text as string,
      start: parseOffsetSeconds(a.start_offset),
      end: parseOffsetSeconds(a.end_offset),
    }));

  const segments: unknown[] = [];
  let current: typeof words = [];
  for (const w of words) {
    current.push(w);
    if (/[.!?…]["'')\]]*$/.test(w.word)) {
      segments.push(current);
      current = [];
    }
  }
  if (current.length > 0) segments.push(current);

  return segments.map((segWords, i) => {
    const ws = segWords as typeof words;
    return {
      id: `seg-${i + 1}`,
      start: ws[0]?.start ?? 0,
      end: ws[ws.length - 1]?.end ?? 0,
      text: ws.map((w) => w.word).join(" "),
      words: ws,
    };
  });
}

async function downloadAudioToTempFile(
  audiobookId: string,
  audioUrl: string,
  targetPath: string
): Promise<void> {
  const candidateUrls = [audioUrl];

  // If archive.org URL, derive direct storage cluster URL as high-reliability fallback
  if (audioUrl.includes("archive.org")) {
    const urlMatch = audioUrl.match(/\/download\/([^/]+)\//);
    const identifierCandidates = [audiobookId];
    if (urlMatch?.[1] && !identifierCandidates.includes(urlMatch[1])) {
      identifierCandidates.push(urlMatch[1]);
    }

    for (const id of identifierCandidates) {
      try {
        const metaRes = await fetch(`https://archive.org/metadata/${encodeURIComponent(id)}`, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        });
        if (metaRes.ok) {
          const meta = await metaRes.json();
          if (meta?.server && meta?.dir) {
            const urlParts = audioUrl.split("/");
            const targetFileName = urlParts[urlParts.length - 1];
            // Match exact file or fallback
            const files = Array.isArray(meta.files) ? meta.files : [];
            const matchedFile = files.find((f: { name?: string }) => f?.name === targetFileName) ||
                                files.find((f: { name?: string }) => f?.name?.endsWith(".mp3"));
            const finalName = matchedFile?.name || targetFileName;
            const directUrl = `https://${meta.server}${meta.dir}/${finalName}`;
            if (!candidateUrls.includes(directUrl)) {
              candidateUrls.unshift(directUrl); // prioritize direct storage server
            }
          }
        }
      } catch {
        // continue
      }
    }
  }

  let lastError: Error | null = null;
  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        redirect: "follow",
      });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        await fs.promises.writeFile(targetPath, Buffer.from(arrayBuffer));
        return;
      }
      lastError = new Error(`HTTP ${res.status} ${res.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw lastError || new Error("Не удалось скачать аудиофайл с серверов хранения");
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    audiobookId?: string;
    chapterIndex?: number;
    audioUrl?: string;
    language?: string;
    duration?: number;
  };

  const audiobookId = (body.audiobookId ?? "").trim();
  const chapterIndex = typeof body.chapterIndex === "number" ? body.chapterIndex : 0;
  const audioUrl = (body.audioUrl ?? "").trim();
  const language = (body.language ?? "de").trim().toLowerCase();

  if (!audiobookId) {
    return NextResponse.json({ error: "Не указан идентификатор аудиокниги." }, { status: 400 });
  }

  if (!audioUrl) {
    return NextResponse.json({ error: "Не указан URL аудиофайла главы." }, { status: 400 });
  }

  // 1. Check Supabase DB cache first (no API key required if already transcribed!)
  if (supabaseAdmin) {
    try {
      const { data: cachedRow } = await supabaseAdmin
        .from("audiobook_transcripts")
        .select("segments, raw_text, model_used, usage, created_at")
        .eq("audiobook_id", audiobookId)
        .eq("chapter_index", chapterIndex)
        .maybeSingle();

      if (cachedRow && Array.isArray(cachedRow.segments) && cachedRow.segments.length > 0) {
        return NextResponse.json({
          audiobookId,
          chapterIndex,
          language,
          segments: normalizeSegments(cachedRow.segments),
          rawText: cachedRow.raw_text,
          modelUsed: cachedRow.model_used,
          usage: cachedRow.usage || undefined,
          createdAt: cachedRow.created_at,
        } satisfies AudiobookTranscript);
      }
    } catch {
      // Ignore if table doesn't exist yet
    }
  }

  // 2. Validate Gemini API Key for on-demand transcription
  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Требуется Gemini API ключ";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  // 3. Download audio file to temporary storage for Files API upload
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `audiobook_${crypto.randomUUID()}.mp3`);
  const mimeType = audioUrl.endsWith(".ogg") ? "audio/ogg" : "audio/mp3";

  try {
    await downloadAudioToTempFile(audiobookId, audioUrl, tempFilePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка загрузки аудио";
    try {
      await fs.promises.unlink(tempFilePath);
    } catch {}
    return NextResponse.json({ error: `Не удалось загрузить аудиофайл: ${msg}` }, { status: 502 });
  }

  const ai = new GoogleGenAI({ apiKey });
  let uploadedFile: { name?: string } | null = null;
  let transcriptResult: AudiobookTranscript | null = null;
  const usedModel = "gemini-3.5-transcribe";

  try {
    // 4. Upload file to Google Gemini Files API (supports files up to 2GB)
    const uploadRes = await ai.files.upload({
      file: tempFilePath,
      config: { mimeType },
    });
    uploadedFile = uploadRes;

    // gemini-3.5-transcribe is a dedicated speech-to-text model, not a chat
    // model: it doesn't support responseMimeType "application/json" (rejects
    // with 400 "JSON mode is not enabled for this model"), and a plain
    // generateContent call against it returns an empty candidate. It's
    // reached through the separate Interactions API instead, with word-level
    // timestamps requested via generation_config.transcription_config. This
    // field isn't in @google/genai's shipped TS types yet (the model launched
    // 2026-08-26), so the extra config is passed through an untyped cast —
    // verified directly against the live API, not just the docs.
    const interaction = await ai.interactions.create({
      model: "gemini-3.5-transcribe",
      input: [
        {
          type: "audio",
          uri: uploadRes.uri,
          mime_type: uploadRes.mimeType,
        },
      ],
      generation_config: {
        transcription_config: {
          language_codes: [toLanguageCode(language)],
          mode: {
            type: "verbatim",
            timestamp_granularities: ["word"],
          },
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const outputText: string = (interaction as { output_text?: string }).output_text || "";
    const steps = (interaction as { steps?: Array<{ content?: Array<{ annotations?: WordAnnotation[] }> }> }).steps || [];
    const annotations = steps.flatMap((s) => s.content || []).flatMap((c) => c.annotations || []);
    const rawSegments = buildSegmentsFromWordAnnotations(annotations);
    const segments = normalizeSegments(rawSegments);

    if (segments.length === 0) {
      throw new Error("Gemini вернул пустую транскрипцию (аудио могло быть без речи или не распознано).");
    }

    const usageRaw = (interaction as {
      usage?: { total_input_tokens?: number; total_output_tokens?: number; total_tokens?: number };
    }).usage;
    let usage: AudiobookTranscript["usage"] = undefined;
    if (usageRaw) {
      const promptTokens = Number(usageRaw.total_input_tokens || 0);
      const outputTokens = Number(usageRaw.total_output_tokens || 0);
      const totalTokens = Number(usageRaw.total_tokens || promptTokens + outputTokens);
      // Official gemini-3.5-transcribe rates (ai.google.dev/gemini-api/docs/pricing,
      // checked 2026-08-28): audio input $2.00 / 1M tokens, text output $12.00 / 1M tokens.
      const costUsd = promptTokens * 0.000002 + outputTokens * 0.000012;
      usage = { promptTokens, outputTokens, totalTokens, costUsd };
    }

    transcriptResult = {
      audiobookId,
      chapterIndex,
      language,
      segments,
      rawText: outputText,
      modelUsed: usedModel,
      usage,
      createdAt: new Date().toISOString(),
    };
  } catch (apiErr) {
    const msg = apiErr instanceof Error ? apiErr.message : "Gemini API failure";
    console.error("Gemini transcription error:", apiErr);
    return NextResponse.json({ error: `Ошибка транскрибации Gemini: ${msg}` }, { status: 500 });
  } finally {
    // Cleanup temporary local file
    try {
      await fs.promises.unlink(tempFilePath);
    } catch {}

    // Cleanup uploaded file from Google storage
    if (uploadedFile?.name) {
      try {
        await ai.files.delete({ name: uploadedFile.name });
      } catch {}
    }
  }

  if (!transcriptResult || transcriptResult.segments.length === 0) {
    return NextResponse.json(
      { error: "Не удалось получить транскрипцию аудио главы. Проверьте Gemini API ключ и повторите попытку." },
      { status: 500 }
    );
  }

  // 5. Save to Supabase DB cache
  if (supabaseAdmin) {
    try {
      await supabaseAdmin.from("audiobook_transcripts").upsert(
        {
          audiobook_id: audiobookId,
          chapter_index: chapterIndex,
          language,
          segments: transcriptResult.segments,
          raw_text: transcriptResult.rawText,
          model_used: transcriptResult.modelUsed,
          usage: transcriptResult.usage || null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "audiobook_id,chapter_index" }
      );
    } catch {
      // Non-fatal if table not created yet
    }
  }

  return NextResponse.json(transcriptResult);
}
