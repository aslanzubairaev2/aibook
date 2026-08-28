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
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Требуется Gemini API ключ";
    return NextResponse.json({ error: msg }, { status: 403 });
  }

  // 3. Download audio file to temporary storage for Files API upload
  const tempDir = os.tmpdir();
  const tempFilePath = path.join(tempDir, `audiobook_${crypto.randomUUID()}.mp3`);
  const mimeType = audioUrl.endsWith(".ogg") ? "audio/ogg" : "audio/mp3";

  try {
    const audioRes = await fetch(audioUrl, {
      headers: {
        "User-Agent": "AIBook/1.0 (Educational Language Learning App)",
      },
    });
    if (!audioRes.ok) {
      throw new Error(`Failed to fetch audio stream: ${audioRes.statusText}`);
    }
    const arrayBuffer = await audioRes.arrayBuffer();
    await fs.promises.writeFile(tempFilePath, Buffer.from(arrayBuffer));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Ошибка загрузки аудио";
    try {
      await fs.promises.unlink(tempFilePath);
    } catch {}
    return NextResponse.json({ error: `Не удалось загрузить аудиофайл: ${msg}` }, { status: 502 });
  }

  const ai = new GoogleGenAI({ apiKey });
  let uploadedFile: { name: string } | null = null;
  let transcriptResult: AudiobookTranscript | null = null;
  let usedModel = "gemini-2.5-flash";

  try {
    // 4. Upload file to Google Gemini Files API (supports files up to 2GB)
    const uploadRes = await ai.files.upload({
      file: tempFilePath,
      mimeType,
    });
    uploadedFile = uploadRes;

    const prompt = `You are a professional audio transcriber for language learners.
Listen to the attached audio file and transcribe EVERY spoken word verbatim in the original spoken language (${language}).
Do not summarize, do not translate, and do not skip any introductory speech, titles, or poems.
Split the spoken audio into clear sentence-level segments with precise start and end timestamps in seconds.
Return ONLY valid JSON matching this schema:
{
  "segments": [
    {
      "start": 0.0,
      "end": 4.8,
      "text": "Verbatim transcribed sentence here."
    }
  ]
}
Timestamps must be numbers in seconds. Every sentence must have accurate start and end timestamps.`;

    const modelsToTry = ["gemini-3.5-transcribe", "gemini-3.7-flash", "gemini-2.5-flash", "gemini-2.0-flash"];

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            uploadRes,
            prompt,
          ],
          config: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
        });

        const text = response.text || "";
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
      } catch (genErr) {
        console.warn(`Model ${modelName} transcription attempt failed:`, genErr);
      }
    }
  } catch (apiErr) {
    const msg = apiErr instanceof Error ? apiErr.message : "Gemini API failure";
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
