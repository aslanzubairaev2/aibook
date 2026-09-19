import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { getApiKeyForRequest } from "@/lib/ai/serverAuth";
import { getUserFromRequest } from "@/lib/auth/serverUser";
import { supabaseAdmin } from "@/lib/db/supabase-admin";
import { smartDictionaryWorkflow } from "@/workflows/smartDictionary";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_REQUEST_LENGTH = 1200;

function clean(value: unknown, max: number): string {
  return String(value ?? "").trim().slice(0, max);
}

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "Войдите, чтобы менять словарь." }, { status: 401 });
  if (!supabaseAdmin) return NextResponse.json({ error: "Supabase не настроен на сервере." }, { status: 503 });

  let apiKey: string;
  try {
    apiKey = await getApiKeyForRequest(req);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Нет доступа к AI." }, { status: 403 });
  }

  const body = await req.json() as {
    mode?: "single" | "topic";
    request?: string;
    inputLanguage?: "auto" | "target" | "native";
    targetLanguage?: string;
    nativeLanguage?: string;
    batchId?: string | null;
  };
  const mode = body.mode === "topic" ? "topic" : "single";
  const request = clean(body.request, MAX_REQUEST_LENGTH);
  const targetLanguage = clean(body.targetLanguage, 40) || "de";
  const nativeLanguage = clean(body.nativeLanguage, 40) || "ru";
  const inputLanguage = clean(body.inputLanguage, 20) || "auto";
  const batchId = clean(body.batchId, 80) || null;
  if (!request) return NextResponse.json({ error: "Напишите слово или тему." }, { status: 400 });

  if (batchId) {
    const { data: batch } = await supabaseAdmin
      .from("dictionary_batches")
      .select("id, language")
      .eq("id", batchId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!batch) return NextResponse.json({ error: "Эта пачка не найдена." }, { status: 404 });
    if (batch.language !== targetLanguage) return NextResponse.json({ error: "Язык пачки не совпадает с выбранным языком." }, { status: 400 });
  }

  const { data: job, error } = await supabaseAdmin
    .from("dictionary_generation_jobs")
    .insert({
      user_id: user.id,
      mode,
      request,
      input_language: inputLanguage,
      target_language: targetLanguage,
      native_language: nativeLanguage,
      batch_id: batchId,
      status: "queued",
      current_action: "Задача поставлена в очередь…",
    })
    .select("id")
    .single();
  if (error || !job) return NextResponse.json({ error: `Не удалось поставить задачу в очередь: ${error?.message ?? "нет ответа"}` }, { status: 500 });

  try {
    const run = await start(smartDictionaryWorkflow, [String(job.id), apiKey]);
    await supabaseAdmin
      .from("dictionary_generation_jobs")
      .update({ workflow_run_id: run.runId, status: "running", current_action: "Фоновая задача запущена…", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("user_id", user.id);
    return NextResponse.json({ jobId: job.id, status: "queued" }, { status: 202 });
  } catch (error) {
    await supabaseAdmin.from("dictionary_generation_jobs").update({ status: "failed", error: error instanceof Error ? error.message : "Не удалось запустить фоновую задачу.", updated_at: new Date().toISOString() }).eq("id", job.id).eq("user_id", user.id);
    return NextResponse.json({ error: "Не удалось запустить фоновую задачу. Попробуйте ещё раз." }, { status: 500 });
  }
}
