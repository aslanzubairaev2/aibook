import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { normalizeSegments } from "@/lib/audio/transcribe";
import type { AudiobookTranscript } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // Allow up to 60s for full chapter transcription

function parseJsonArrayOrObject(text: string) {
  const cleaned = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    const arrStart = cleaned.indexOf("[");
    const arrEnd = cleaned.lastIndexOf("]");
    if (arrStart >= 0 && arrEnd > arrStart) {
      return { segments: JSON.parse(cleaned.slice(arrStart, arrEnd + 1)) };
    }
    throw new Error("AI returned invalid JSON");
  }
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
        .select("segments, raw_text, model_used, created_at")
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
  } catch {
    return NextResponse.json(
      {
        error:
          "Для распознавания речи требуется Gemini API ключ. Пожалуйста, укажите ваш ключ в Настройках (значок шестерёнки в меню слева).",
      },
      { status: 403 }
    );
  }

  // 3. Fetch audio data from archive.org CDN
  let audioBuffer: ArrayBuffer;
  try {
    const audioRes = await fetch(audioUrl, {
      headers: {
        "User-Agent": "AIBook/1.0 (Educational Language Learning App)",
      },
    });
    if (!audioRes.ok) {
      throw new Error(`Failed to fetch audio stream: ${audioRes.statusText}`);
    }
    audioBuffer = await audioRes.arrayBuffer();
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка загрузки аудио";
    return NextResponse.json({ error: `Не удалось загрузить аудиофайл: ${msg}` }, { status: 502 });
  }

  const base64Audio = Buffer.from(audioBuffer).toString("base64");
  const mimeType = audioUrl.endsWith(".ogg") ? "audio/ogg" : "audio/mp3";

  // 4. System instructions & prompt for Gemini 3.5 Transcribe
  const prompt = `You are a high-precision audiobook transcriber for language learners.
Transcribe the spoken audio verbatim in the original spoken language (${language}).
Preserve proper capitalization (especially German nouns), punctuation, and sentence boundaries.
Do not translate. Return ONLY a valid JSON object matching this schema:
{
  "segments": [
    {
      "start": 0.0,
      "end": 4.5,
      "text": "Exact sentence spoken.",
      "words": [
        { "word": "Exact", "start": 0.0, "end": 0.5 },
        { "word": "sentence", "start": 0.55, "end": 1.2 },
        { "word": "spoken.", "start": 1.25, "end": 2.0 }
      ]
    }
  ]
}
Timestamps must be numbers in seconds. Every sentence must have accurate start and end timestamps.`;

  let transcriptResult: AudiobookTranscript | null = null;
  let usedModel = "gemini-3.5-transcribe";

  // Try gemini-3.5-transcribe first, fallback to gemini-2.0-flash / gemini-1.5-flash
  const modelsToTry = ["gemini-3.5-transcribe", "gemini-2.0-flash", "gemini-1.5-flash"];
  const genAI = new GoogleGenerativeAI(apiKey);

  for (const modelName of modelsToTry) {
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.1,
        },
      });

      const result = await model.generateContent([
        {
          inlineData: {
            data: base64Audio,
            mimeType,
          },
        },
        prompt,
      ]);

      const text = result.response.text();
      const parsed = parseJsonArrayOrObject(text);
      const rawSegments = Array.isArray(parsed) ? parsed : parsed.segments || [];
      const segments = normalizeSegments(rawSegments);

      if (segments.length > 0) {
        usedModel = modelName;
        transcriptResult = {
          audiobookId,
          chapterIndex,
          language,
          segments,
          rawText: text,
          modelUsed: usedModel,
          createdAt: new Date().toISOString(),
        };
        break;
      }
    } catch (modelErr) {
      console.warn(`Model ${modelName} failed or unavailable:`, modelErr);
      // continue to next fallback model
    }
  }

  if (!transcriptResult || transcriptResult.segments.length === 0) {
    return NextResponse.json(
      { error: "Не удалось получить транскрипцию аудио главы. Попробуйте еще раз позже." },
      { status: 500 }
    );
  }

  // 5. Save to Supabase DB cache in the background
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
