// Database work for interactive tests, shared by the teacher's MCP tools and
// the learner's API route. Everything runs with the service-role client and is
// scoped to one user id by the caller's verified identity.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  allItems,
  normalizeAssessmentInput,
  needsTeacher,
  DIMENSIONS,
  SKILLS,
  type AssessmentContent,
  type AssessmentDraft,
  type AudioSpec,
  type Dimension,
  type Item,
  type Section,
} from "./model";
import {
  countWords,
  gradeAll,
  hasManualItems,
  isAnswered,
  summarizeDimensions,
  summarizeSkills,
  totals,
  type AnswerRecord,
  type AnswerValue,
  type DimensionMark,
  type TeacherReview,
} from "./grading";
import {
  buildPublicView,
  isClosed,
  isSectionDone,
  itemLocked,
  listensUsed,
  resultsReleased,
  sectionAvailable,
  type AttemptRow,
  type AttemptSnapshot,
  type AudioState,
} from "./publicView";
import { assessmentTtsModels, audioSpecHash, synthesizeListening } from "./speech";

const AUDIO_BUCKET = "tts-audio";
const LOCK_SECONDS = 120;

export type AssessmentRow = {
  id: string;
  user_id: string;
  client_key: string | null;
  title: string;
  description: string;
  language: string;
  mode: AssessmentDraft["mode"];
  status: "draft" | "published" | "archived";
  content: AssessmentContent;
  settings: AssessmentDraft["settings"];
  version: number;
  created_at: string;
  updated_at: string;
  published_at: string | null;
};

type AudioRow = {
  id: string;
  section_id: string;
  spec_hash: string;
  status: AudioState["status"];
  storage_path: string | null;
  duration_ms: number | null;
  model: string | null;
  error: string | null;
  tries: number;
  locked_until: string | null;
};

export class AssessmentError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export function testLink(origin: string, id: string): string {
  return `${origin.replace(/\/$/, "")}/test/${id}`;
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function getAssessment(admin: SupabaseClient, userId: string, id: string): Promise<AssessmentRow> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AssessmentError("No such test.", 404);
  const { data, error } = await admin.from("assessments").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
  if (error) throw new AssessmentError(`test read failed: ${error.message}`, 500);
  if (!data) throw new AssessmentError("No such test in this learner's app.", 404);
  return data as AssessmentRow;
}

export async function getAudioRows(admin: SupabaseClient, assessmentId: string): Promise<AudioRow[]> {
  const { data, error } = await admin
    .from("assessment_audio")
    .select("id, section_id, spec_hash, status, storage_path, duration_ms, model, error, tries, locked_until")
    .eq("assessment_id", assessmentId);
  if (error) throw new AssessmentError(`audio read failed: ${error.message}`, 500);
  return (data ?? []) as AudioRow[];
}

function audioStates(rows: AudioRow[]): Record<string, AudioState> {
  return Object.fromEntries(rows.map((r) => [r.section_id, { status: r.status, duration_ms: r.duration_ms }]));
}

function audioSections(content: AssessmentContent): { section: Section; spec: AudioSpec }[] {
  return content.sections.flatMap((section) =>
    section.stimulus?.type === "audio" ? [{ section, spec: section.stimulus.audio }] : [],
  );
}

// ─── Teacher: create / update ────────────────────────────────────────────────

/**
 * Keep one audio row per audio section, in step with the content. A changed
 * spec resets its row; an unchanged one keeps its recording; a spec any
 * earlier test of this learner already recorded is reused without a request.
 */
async function syncAudioRows(admin: SupabaseClient, userId: string, assessmentId: string, content: AssessmentContent) {
  const existing = await getAudioRows(admin, assessmentId);
  const model = assessmentTtsModels()[0];
  const wanted = audioSections(content).map(({ section, spec }) => ({
    section_id: section.id,
    spec,
    spec_hash: audioSpecHash(spec, model),
  }));

  const stale = existing.filter((row) => !wanted.some((w) => w.section_id === row.section_id)).map((r) => r.id);
  if (stale.length > 0) await admin.from("assessment_audio").delete().in("id", stale);

  for (const w of wanted) {
    const row = existing.find((r) => r.section_id === w.section_id);
    if (row && row.spec_hash === w.spec_hash) continue;

    const { data: cached } = await admin
      .from("assessment_audio")
      .select("storage_path, duration_ms, model")
      .eq("user_id", userId)
      .eq("spec_hash", w.spec_hash)
      .eq("status", "ready")
      .limit(1)
      .maybeSingle();

    const values = {
      assessment_id: assessmentId,
      user_id: userId,
      section_id: w.section_id,
      spec: w.spec,
      spec_hash: w.spec_hash,
      status: cached?.storage_path ? "ready" : "pending",
      storage_path: cached?.storage_path ?? null,
      duration_ms: cached?.duration_ms ?? null,
      model: cached?.model ?? null,
      error: null,
      tries: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await admin.from("assessment_audio").upsert(values, { onConflict: "assessment_id,section_id" });
    if (error) throw new AssessmentError(`audio row write failed: ${error.message}`, 500);
  }
}

export async function createAssessment(
  admin: SupabaseClient,
  userId: string,
  args: Record<string, unknown>,
  fallbackLanguage: string,
): Promise<{ row: AssessmentRow; reused: boolean }> {
  const clientKey = typeof args.client_key === "string" && args.client_key.trim()
    ? args.client_key.trim().slice(0, 120)
    : null;

  if (clientKey) {
    const { data } = await admin.from("assessments").select("*").eq("user_id", userId).eq("client_key", clientKey).maybeSingle();
    if (data) return { row: data as AssessmentRow, reused: true };
  }

  const draft = normalizeAssessmentInput(args, fallbackLanguage);
  const { data, error } = await admin
    .from("assessments")
    .insert({
      user_id: userId,
      client_key: clientKey,
      title: draft.title,
      description: draft.description,
      language: draft.language,
      mode: draft.mode,
      content: draft.content,
      settings: draft.settings,
    })
    .select("*")
    .single();
  if (error) {
    // Two retries racing on the same key: the loser reads the winner's row.
    if (clientKey && /duplicate|unique/i.test(error.message)) {
      const { data: winner } = await admin.from("assessments").select("*").eq("user_id", userId).eq("client_key", clientKey).single();
      if (winner) return { row: winner as AssessmentRow, reused: true };
    }
    throw new AssessmentError(`test insert failed: ${error.message}`, 500);
  }
  await syncAudioRows(admin, userId, data.id as string, draft.content);
  return { row: data as AssessmentRow, reused: false };
}

export async function updateAssessment(
  admin: SupabaseClient,
  userId: string,
  id: string,
  args: Record<string, unknown>,
): Promise<{ row: AssessmentRow; attemptsKeepTheirVersion: number }> {
  const current = await getAssessment(admin, userId, id);
  if (current.status === "archived") throw new AssessmentError("This test is archived; create a new one.");

  // Anything not passed keeps its current value; sections are replaced whole.
  const merged = {
    title: args.title ?? current.title,
    description: args.description ?? current.description,
    language: args.language ?? current.language,
    mode: args.mode ?? current.mode,
    settings: { ...current.settings, ...(typeof args.settings === "object" && args.settings ? args.settings : {}) },
    sections: args.sections ?? current.content.sections,
  };
  const draft = normalizeAssessmentInput(merged, current.language);

  const status = args.status === "archived" ? "archived" : current.status;
  const { data, error } = await admin
    .from("assessments")
    .update({
      title: draft.title,
      description: draft.description,
      language: draft.language,
      mode: draft.mode,
      content: draft.content,
      settings: draft.settings,
      status,
      version: current.version + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw new AssessmentError(`test update failed: ${error.message}`, 500);
  await syncAudioRows(admin, userId, id, draft.content);

  const { count } = await admin.from("assessment_attempts").select("id", { count: "exact", head: true }).eq("assessment_id", id);
  return { row: data as AssessmentRow, attemptsKeepTheirVersion: count ?? 0 };
}

// ─── Teacher: audio ──────────────────────────────────────────────────────────

/**
 * Generate what is still missing, inside a time budget.
 *
 * Every row is claimed with a conditional update before any request is made,
 * so two overlapping calls (a retry, the learner's page) never pay for the
 * same recording twice; a claim that crashed expires after LOCK_SECONDS.
 */
export async function prepareAudio(
  admin: SupabaseClient,
  userId: string,
  id: string,
  opts: { sectionIds?: string[]; force?: boolean; budgetMs?: number } = {},
) {
  const assessment = await getAssessment(admin, userId, id);
  await syncAudioRows(admin, userId, id, assessment.content);
  const started = Date.now();
  // No new recording starts past this point, so the call ends inside the
  // route's 60-second limit even when the last one takes twenty seconds.
  const budget = opts.budgetMs ?? 25000;
  const specs = new Map(audioSections(assessment.content).map(({ section, spec }) => [section.id, spec]));

  const rows = await getAudioRows(admin, id);
  const todo = rows.filter((r) =>
    (!opts.sectionIds || opts.sectionIds.includes(r.section_id))
    && (opts.force ? r.status !== "generating" || lockExpired(r) : r.status === "pending" || r.status === "error" || (r.status === "generating" && lockExpired(r))),
  );

  const generated: string[] = [];
  for (const row of todo) {
    if (Date.now() - started > budget) break;
    const spec = specs.get(row.section_id);
    if (!spec) continue;

    const now = new Date();
    const { data: claimed } = await admin
      .from("assessment_audio")
      .update({ status: "generating", locked_until: new Date(now.getTime() + LOCK_SECONDS * 1000).toISOString(), tries: row.tries + 1, updated_at: now.toISOString() })
      .eq("id", row.id)
      .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    try {
      const path = `assessments/${row.spec_hash}.wav`;
      const result = await synthesizeListening(spec);
      const { error: uploadError } = await admin.storage.from(AUDIO_BUCKET).upload(path, result.wav, {
        contentType: "audio/wav",
        upsert: true,
      });
      if (uploadError) throw new Error(`storage upload failed: ${uploadError.message}`);
      await admin.from("assessment_audio").update({
        status: "ready", storage_path: path, duration_ms: result.durationMs, model: result.model,
        error: null, locked_until: null, updated_at: new Date().toISOString(),
      }).eq("id", row.id);
      generated.push(row.section_id);
    } catch (error) {
      await admin.from("assessment_audio").update({
        status: "error",
        error: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
        locked_until: null,
        updated_at: new Date().toISOString(),
      }).eq("id", row.id);
    }
  }

  return { generated, audio: describeAudio(await getAudioRows(admin, id)) };
}

function lockExpired(row: AudioRow): boolean {
  return !row.locked_until || Date.parse(row.locked_until) < Date.now();
}

function describeAudio(rows: AudioRow[]) {
  return rows.map((r) => ({
    section_id: r.section_id,
    status: r.status === "generating" && lockExpired(r) ? "pending" : r.status,
    duration_seconds: r.duration_ms ? Math.round(r.duration_ms / 100) / 10 : null,
    model: r.model,
    error: r.error,
    tries: r.tries,
  }));
}

// ─── Teacher: status / publish / list ───────────────────────────────────────

export async function assessmentStatus(admin: SupabaseClient, userId: string, id: string, origin: string) {
  const a = await getAssessment(admin, userId, id);
  const audio = describeAudio(await getAudioRows(admin, id));
  const { data: attempts } = await admin
    .from("assessment_attempts")
    .select("id, status, started_at, submitted_at")
    .eq("assessment_id", id)
    .order("started_at", { ascending: false });
  const items = allItems(a.content);
  const notReady = audio.filter((x) => x.status !== "ready");
  return {
    id: a.id,
    title: a.title,
    mode: a.mode,
    status: a.status,
    version: a.version,
    sections: a.content.sections.map((s) => ({ id: s.id, title: s.title, skill: s.skill, items: s.items.length, stimulus: s.stimulus?.type ?? null })),
    items: items.length,
    max_score: items.reduce((n, { item }) => n + item.points, 0),
    manual_items: items.filter(({ item }) => needsTeacher(item)).map(({ item }) => item.id),
    audio,
    ready_to_publish: notReady.length === 0,
    link: a.status === "published" ? testLink(origin, a.id) : null,
    attempts: attempts ?? [],
    next_step: a.status === "draft"
      ? notReady.length > 0
        ? "Call prepare_assessment_audio until every audio section is 'ready', then publish_assessment."
        : "Call publish_assessment and give the learner the link."
      : "Wait for the learner, then get_assessment_results.",
  };
}

export async function publishAssessment(admin: SupabaseClient, userId: string, id: string, origin: string) {
  const a = await getAssessment(admin, userId, id);
  if (a.status === "archived") throw new AssessmentError("This test is archived.");
  const audio = describeAudio(await getAudioRows(admin, id));
  const missing = audio.filter((x) => x.status !== "ready");
  if (missing.length > 0) {
    throw new AssessmentError(
      `Audio is not ready for: ${missing.map((m) => `${m.section_id} (${m.status}${m.error ? `: ${m.error}` : ""})`).join(", ")}. Call prepare_assessment_audio first.`,
    );
  }
  if (a.status !== "published") {
    const { error } = await admin.from("assessments")
      .update({ status: "published", published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", userId);
    if (error) throw new AssessmentError(`publish failed: ${error.message}`, 500);
  }
  return {
    id,
    status: "published",
    link: testLink(origin, id),
    note: "The learner opens the link (or finds the test on the home screen of the app). Results arrive through get_assessment_results.",
  };
}

export async function listAssessments(admin: SupabaseClient, userId: string, opts: { status?: string; limit?: number } = {}) {
  let query = admin
    .from("assessments")
    .select("id, title, description, mode, status, language, created_at, published_at, version, content")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(Math.min(50, opts.limit ?? 20));
  if (opts.status) query = query.eq("status", opts.status);
  const { data, error } = await query;
  if (error) throw new AssessmentError(`tests read failed: ${error.message}`, 500);
  const ids = (data ?? []).map((a) => a.id as string);
  const { data: attempts } = ids.length
    ? await admin.from("assessment_attempts")
      .select("id, assessment_id, status, started_at, submitted_at, reviewed_at, answers, snapshot, review")
      .in("assessment_id", ids)
      .order("started_at", { ascending: false })
    : { data: [] };

  return (data ?? []).map((a) => ({
    id: a.id,
    title: a.title,
    description: a.description,
    mode: a.mode,
    status: a.status,
    language: a.language,
    created_at: a.created_at,
    published_at: a.published_at,
    items: allItems(a.content as AssessmentContent).length,
    attempts: (attempts ?? []).filter((t) => t.assessment_id === a.id).map((t) => {
      const results = gradeAll((t.snapshot as AttemptSnapshot).content, (t.answers ?? {}) as Record<string, AnswerRecord>, t.review as TeacherReview | null);
      return {
        attempt_id: t.id,
        status: t.status,
        started_at: t.started_at,
        submitted_at: t.submitted_at,
        reviewed_at: t.reviewed_at,
        totals: totals(results),
      };
    }),
  }));
}

// ─── Teacher: results, review, gaps ─────────────────────────────────────────

async function getAttempt(admin: SupabaseClient, userId: string, attemptId: string): Promise<AttemptRow> {
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) throw new AssessmentError("No such attempt.", 404);
  const { data, error } = await admin.from("assessment_attempts").select("*").eq("id", attemptId).eq("user_id", userId).maybeSingle();
  if (error) throw new AssessmentError(`attempt read failed: ${error.message}`, 500);
  if (!data) throw new AssessmentError("No such attempt.", 404);
  return data as AttemptRow;
}

async function resolveAttempt(admin: SupabaseClient, userId: string, args: { attempt_id?: unknown; assessment_id?: unknown }) {
  if (typeof args.attempt_id === "string" && args.attempt_id) return getAttempt(admin, userId, args.attempt_id);
  if (typeof args.assessment_id !== "string" || !args.assessment_id) {
    throw new AssessmentError("Pass 'attempt_id', or 'assessment_id' for its latest attempt.");
  }
  const { data } = await admin.from("assessment_attempts").select("*")
    .eq("assessment_id", args.assessment_id).eq("user_id", userId)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (!data) throw new AssessmentError("The learner has not opened this test yet.", 404);
  return data as AttemptRow;
}

/** An answer as a person would read it: option texts, not option ids. */
export function readableAnswer(item: Item, value: AnswerValue | null): string {
  if (value === null || value === undefined) return "";
  switch (item.type) {
    case "single_choice":
      return item.options.find((o) => o.id === value)?.text ?? String(value);
    case "multiple_choice":
      return (Array.isArray(value) ? value : []).map((v) => item.options.find((o) => o.id === v)?.text ?? v).join("; ");
    case "gap_select":
    case "gap_text": {
      const given = typeof value === "object" && !Array.isArray(value) ? value : {};
      return item.text.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, gid: string) => `[${given[gid] ?? "—"}]`);
    }
    case "word_order":
      return Array.isArray(value) ? value.join(" ") : String(value);
    default:
      return typeof value === "string" ? value : JSON.stringify(value);
  }
}

export async function assessmentResults(admin: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const attempt = await resolveAttempt(admin, userId, args);
  const { content, mode, settings, title } = attempt.snapshot;
  const results = gradeAll(content, attempt.answers ?? {}, attempt.review);
  const byItem = new Map(results.map((r) => [r.item_id, r]));

  const sections = content.sections.map((section) => ({
    id: section.id,
    title: section.title,
    skill: section.skill,
    completed: isSectionDone(attempt, section.id),
    listening: section.stimulus?.type === "audio"
      ? {
          max_plays: section.stimulus.max_plays,
          used: listensUsed(attempt, section.id),
          plays_at: attempt.listens?.[section.id]?.plays ?? [],
          transcript: section.stimulus.audio.kind === "monologue" ? section.stimulus.audio.text : section.stimulus.audio.lines,
        }
      : null,
    reading_text: section.stimulus?.type === "text" ? section.stimulus.paragraphs : null,
    items: section.items.map((item) => {
      const record = attempt.answers?.[item.id];
      const r = byItem.get(item.id)!;
      return {
        item_id: item.id,
        type: item.type,
        prompt: item.prompt,
        ...(item.type === "single_choice" || item.type === "multiple_choice" ? { options: item.options } : {}),
        ...(item.type === "gap_select" || item.type === "gap_text" ? { text: item.text } : {}),
        expected: r.expected,
        criteria: item.criteria || null,
        // Exactly what the learner gave, plus how a person would read it.
        answer_raw: record?.value ?? null,
        answer: readableAnswer(item, record?.value ?? null),
        // A record holding only an autosaved draft is not an answer yet.
        answer_status: (record && isAnswered(record) ? record.status : "unanswered") as
          "answered" | "dont_know" | "unanswered",
        unsent_draft: record?.draft && !record.value ? readableAnswer(item, record.draft) : null,
        first_answer: record ? readableAnswer(item, record.first_value) : null,
        changes: record ? record.history.length - 1 : 0,
        history: record?.history.map((h) => ({ answer: readableAnswer(item, h.value), status: h.status, at: h.at })) ?? [],
        tries: record?.tries ?? 0,
        word_count: item.type === "writing" && typeof record?.value === "string" ? countWords(record.value) : undefined,
        result: r,
        needs_your_review: needsTeacher(item) && r.graded_by !== "teacher" && r.status === "pending_review",
      };
    }),
  }));

  const unfinished = sections.flatMap((s) => s.items.filter((i) => i.answer_status === "unanswered").map((i) => i.item_id));
  return {
    attempt_id: attempt.id,
    assessment_id: attempt.assessment_id,
    title,
    mode,
    results_release: settings.results_release,
    status: attempt.status,
    started_at: attempt.started_at,
    submitted_at: attempt.submitted_at,
    reviewed_at: attempt.reviewed_at,
    totals: totals(results),
    skills: summarizeSkills(content, results),
    dimensions: summarizeDimensions(results),
    unfinished_items: unfinished,
    awaiting_your_review: sections.flatMap((s) => s.items.filter((i) => i.needs_your_review || i.result.needs_teacher_check).map((i) => i.item_id)),
    learner_sees_results: resultsReleased(attempt),
    sections,
    review: attempt.review,
    note: attempt.status === "in_progress"
      ? "The attempt is still open: answers can change until the learner submits."
      : "Grade every item in awaiting_your_review with submit_assessment_review. Typos are already scored as half points with spelling marked; confirm or override them.",
  };
}

function mark(value: unknown): DimensionMark | null {
  return value === "ok" || value === "minor" || value === "error" ? value : null;
}

export async function submitReview(admin: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const attempt = await resolveAttempt(admin, userId, args);
  if (attempt.status === "in_progress") {
    throw new AssessmentError("The learner has not submitted this attempt yet; review it after submission.");
  }
  const items = new Map(allItems(attempt.snapshot.content).map(({ item }) => [item.id, item]));
  const previous = attempt.review?.items ?? [];

  const rawItems = Array.isArray(args.items) ? args.items : [];
  const problems: string[] = [];
  const reviewed = rawItems.flatMap((raw) => {
    const r = (raw ?? {}) as Record<string, unknown>;
    const itemId = String(r.item_id ?? "");
    const item = items.get(itemId);
    if (!item) { problems.push(`unknown item_id «${itemId}»`); return []; }
    const score = Number(r.score);
    if (!Number.isFinite(score) || score < 0 || score > item.points) {
      problems.push(`${itemId}: score must be 0…${item.points}`);
      return [];
    }
    const dims: Partial<Record<Dimension, DimensionMark>> = {};
    const rawDims = (typeof r.dimensions === "object" && r.dimensions ? r.dimensions : {}) as Record<string, unknown>;
    for (const d of DIMENSIONS) {
      const m = mark(rawDims[d]);
      if (m) dims[d] = m;
    }
    return [{
      item_id: itemId,
      score,
      comment: String(r.comment ?? "").slice(0, 3000),
      dimensions: dims,
      corrected: String(r.corrected ?? "").slice(0, 5000),
    }];
  });
  if (problems.length > 0) throw new AssessmentError(`Review not saved:\n- ${problems.join("\n- ")}`);

  // A second review call adds to the first instead of wiping it.
  const mergedItems = [...previous.filter((p) => !reviewed.some((r) => r.item_id === p.item_id)), ...reviewed];
  const gaps = (Array.isArray(args.gaps) ? args.gaps : []).slice(0, 30).map((g) => {
    const raw = (g ?? {}) as Record<string, unknown>;
    return {
      topic: String(raw.topic ?? "").slice(0, 200),
      skill: (SKILLS as readonly string[]).includes(String(raw.skill)) ? raw.skill as TeacherReview["gaps"][number]["skill"] : null,
      description: String(raw.description ?? "").slice(0, 2000),
      words: (Array.isArray(raw.words) ? raw.words : []).map((w) => String(w).slice(0, 120)).slice(0, 50),
    };
  }).filter((g) => g.topic || g.description);

  const review: TeacherReview = {
    items: mergedItems,
    summary: typeof args.summary === "string" ? args.summary.slice(0, 5000) : attempt.review?.summary ?? "",
    gaps: gaps.length > 0 ? gaps : attempt.review?.gaps ?? [],
    reviewed_at: new Date().toISOString(),
  };

  const stillPending = allItems(attempt.snapshot.content)
    .filter(({ item }) => needsTeacher(item) && attempt.answers?.[item.id]?.status === "answered"
      && !mergedItems.some((r) => r.item_id === item.id))
    .map(({ item }) => item.id);
  const finished = args.final !== false && stillPending.length === 0;

  const { error } = await admin.from("assessment_attempts").update({
    review,
    status: finished ? "reviewed" : attempt.status,
    reviewed_at: finished ? new Date().toISOString() : attempt.reviewed_at,
    updated_at: new Date().toISOString(),
  }).eq("id", attempt.id).eq("user_id", userId);
  if (error) throw new AssessmentError(`review save failed: ${error.message}`, 500);

  const results = gradeAll(attempt.snapshot.content, attempt.answers ?? {}, review);
  return {
    attempt_id: attempt.id,
    status: finished ? "reviewed" : attempt.status,
    items_reviewed: reviewed.length,
    still_waiting_for_review: stillPending,
    totals: totals(results),
    skills: summarizeSkills(attempt.snapshot.content, results),
    learner_sees_results: finished || attempt.snapshot.settings.results_release !== "after_review",
  };
}

export async function learningGaps(admin: SupabaseClient, userId: string, args: Record<string, unknown>) {
  let attempts: AttemptRow[];
  if (args.attempt_id || args.assessment_id) {
    attempts = [await resolveAttempt(admin, userId, args)];
  } else {
    const { data } = await admin.from("assessment_attempts").select("*")
      .eq("user_id", userId).neq("status", "in_progress")
      .order("started_at", { ascending: false }).limit(Math.min(10, Number(args.limit) || 5));
    attempts = (data ?? []) as AttemptRow[];
  }

  const errors = attempts.flatMap((attempt) => {
    const results = gradeAll(attempt.snapshot.content, attempt.answers ?? {}, attempt.review);
    const byItem = new Map(results.map((r) => [r.item_id, r]));
    return allItems(attempt.snapshot.content).flatMap(({ section, item }) => {
      const r = byItem.get(item.id)!;
      if (r.status === "correct" || r.status === "unanswered" || r.status === "pending_review") return [];
      return [{
        attempt_id: attempt.id,
        test: attempt.snapshot.title,
        section: section.title,
        skill: item.skill ?? section.skill,
        item_id: item.id,
        prompt: item.prompt || (item.type === "gap_text" || item.type === "gap_select" ? item.text : ""),
        status: r.status,
        learner_answer: readableAnswer(item, attempt.answers?.[item.id]?.value ?? null),
        expected: r.expected,
        error_in: Object.entries(r.dimensions).filter(([, m]) => m !== "ok").map(([d]) => d),
        teacher_comment: r.teacher_comment,
      }];
    });
  });

  const teacherGaps = attempts.flatMap((a) => (a.review?.gaps ?? []).map((g) => ({ ...g, attempt_id: a.id, test: a.snapshot.title })));
  const byDimension: Record<string, number> = {};
  for (const e of errors) for (const d of e.error_in.length ? e.error_in : ["unknown"]) byDimension[d] = (byDimension[d] ?? 0) + 1;

  return {
    attempts: attempts.map((a) => ({ attempt_id: a.id, test: a.snapshot.title, status: a.status, submitted_at: a.submitted_at })),
    errors,
    errors_by_dimension: byDimension,
    teacher_gaps: teacherGaps,
    how_to_build_a_review_pack: [
      "Choose the material yourself: a wrong answer does not mean every word in it is unknown.",
      "Run check_dictionary_words on your candidates first and leave out what the learner already has.",
      "Only single words and fixed expressions (content_type 'word' or 'expression') go into the dictionary and cards — never ordinary practice sentences, names of people or organisations.",
      "Create the pack with add_word_batch (article, plural, verb forms, translation, example), describe it with 'description' and 'instruction', and set 'training' if it should be drilled a particular way.",
    ],
  };
}

// ─── Learner ─────────────────────────────────────────────────────────────────

export async function listForLearner(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("assessments")
    .select("id, title, description, mode, published_at")
    .eq("user_id", userId).eq("status", "published")
    .order("published_at", { ascending: false }).limit(30);
  if (error) throw new AssessmentError(`tests read failed: ${error.message}`, 500);
  const ids = (data ?? []).map((a) => a.id as string);
  const { data: attempts } = ids.length
    ? await admin.from("assessment_attempts").select("assessment_id, status, started_at, answers, snapshot")
      .in("assessment_id", ids).order("started_at", { ascending: false })
    : { data: [] };
  return (data ?? []).map((a) => {
    const latest = (attempts ?? []).find((t) => t.assessment_id === a.id);
    const items = latest ? allItems((latest.snapshot as AttemptSnapshot).content).length : null;
    return {
      id: a.id,
      title: a.title,
      description: a.description,
      mode: a.mode,
      published_at: a.published_at,
      state: latest ? latest.status : "new",
      answered: latest ? Object.values((latest.answers ?? {}) as Record<string, AnswerRecord>).filter(isAnswered).length : 0,
      items,
    };
  });
}

async function latestAttempt(admin: SupabaseClient, userId: string, assessmentId: string): Promise<AttemptRow | null> {
  const { data } = await admin.from("assessment_attempts").select("*")
    .eq("assessment_id", assessmentId).eq("user_id", userId)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return (data as AttemptRow | null) ?? null;
}

/** The learner opens the test: their open attempt, or a new one frozen to the current version. */
export async function openAttempt(admin: SupabaseClient, userId: string, assessmentId: string, retake = false): Promise<AttemptRow> {
  const a = await getAssessment(admin, userId, assessmentId);
  if (a.status !== "published") throw new AssessmentError("This test is not published yet.", 403);
  const latest = await latestAttempt(admin, userId, assessmentId);
  if (latest && (latest.status === "in_progress" || !(retake && a.settings.allow_retake))) return latest;

  const snapshot: AttemptSnapshot = {
    title: a.title,
    description: a.description,
    language: a.language,
    mode: a.mode,
    settings: a.settings,
    content: a.content,
    version: a.version,
  };
  const { data, error } = await admin.from("assessment_attempts")
    .insert({ assessment_id: assessmentId, user_id: userId, snapshot })
    .select("*").single();
  if (error) throw new AssessmentError(`attempt start failed: ${error.message}`, 500);
  return data as AttemptRow;
}

export async function learnerView(admin: SupabaseClient, userId: string, assessmentId: string, attempt: AttemptRow) {
  const rows = await getAudioRows(admin, assessmentId);
  return buildPublicView(attempt, audioStates(rows), { assessmentId });
}

function findItem(attempt: AttemptRow, itemId: string): { section: Section; item: Item } {
  const found = allItems(attempt.snapshot.content).find(({ item }) => item.id === itemId);
  if (!found) throw new AssessmentError("No such item in this test.", 404);
  return found;
}

/** Hold a value to the shape its item type answers with. */
export function cleanValue(item: Item, value: unknown): AnswerValue | null {
  switch (item.type) {
    case "single_choice":
      return typeof value === "string" && item.options.some((o) => o.id === value) ? value : null;
    case "multiple_choice":
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && item.options.some((o) => o.id === v)) : null;
    case "gap_select":
    case "gap_text": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
      const out: Record<string, string> = {};
      for (const gap of item.gaps) {
        const v = (value as Record<string, unknown>)[gap.id];
        if (typeof v === "string") out[gap.id] = v.slice(0, 200);
      }
      return out;
    }
    case "word_order":
      return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string").slice(0, 40) : null;
    case "short_answer":
      return typeof value === "string" ? value.slice(0, 2000) : null;
    case "writing":
      return typeof value === "string" ? value.slice(0, 10000) : null;
  }
}

async function saveAttempt(admin: SupabaseClient, attempt: AttemptRow, patch: Partial<AttemptRow>) {
  const { data, error } = await admin.from("assessment_attempts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", attempt.id).eq("user_id", attempt.user_id)
    .select("*").single();
  if (error) throw new AssessmentError(`save failed: ${error.message}`, 500);
  return data as AttemptRow;
}

export type LearnerAction =
  | { action: "draft"; item_id: string; value: unknown }
  | { action: "answer"; item_id: string; value: unknown }
  | { action: "dont_know"; item_id: string }
  | { action: "complete_section"; section_id: string }
  | { action: "submit" };

export async function applyLearnerAction(admin: SupabaseClient, attempt: AttemptRow, input: LearnerAction): Promise<AttemptRow> {
  if (isClosed(attempt)) throw new AssessmentError("The test has already been submitted.", 409);
  const now = new Date().toISOString();

  if (input.action === "submit") {
    const sections = { ...(attempt.sections ?? {}) };
    for (const s of attempt.snapshot.content.sections) sections[s.id] ??= { completed_at: now };
    const manual = hasManualItems(attempt.snapshot.content);
    return saveAttempt(admin, attempt, {
      sections,
      status: "submitted",
      submitted_at: now,
      // Nothing for a teacher to grade: the test is final the moment it is in.
      ...(manual ? {} : { status: "reviewed" as const, reviewed_at: now }),
    });
  }

  if (input.action === "complete_section") {
    const section = attempt.snapshot.content.sections.find((s) => s.id === input.section_id);
    if (!section) throw new AssessmentError("No such section.", 404);
    if (!sectionAvailable(attempt, section.id)) throw new AssessmentError("Finish the earlier sections first.", 409);
    return saveAttempt(admin, attempt, { sections: { ...(attempt.sections ?? {}), [section.id]: { completed_at: now } } });
  }

  const { section, item } = findItem(attempt, input.item_id);
  if (!sectionAvailable(attempt, section.id)) throw new AssessmentError("This section is not open yet.", 409);
  const results = gradeAll(attempt.snapshot.content, attempt.answers ?? {}, attempt.review);
  const result = results.find((r) => r.item_id === item.id)!;
  if (itemLocked(attempt, section, item, result)) throw new AssessmentError("This answer is final.", 409);
  if (section.stimulus?.type === "audio" && section.stimulus.unlock_questions === "after_first_play" && listensUsed(attempt, section.id) === 0) {
    throw new AssessmentError("Listen to the recording first.", 409);
  }

  const previous = attempt.answers?.[item.id];
  let record: AnswerRecord;
  if (input.action === "draft") {
    const draft = cleanValue(item, input.value);
    record = previous
      ? { ...previous, draft, updated_at: now }
      : { value: null, status: "answered", draft, first_value: null, first_status: "answered", first_at: "", history: [], tries: 0, updated_at: now };
    // A draft is not an answer: nothing is graded and nothing enters history.
    return saveAttempt(admin, attempt, { answers: { ...(attempt.answers ?? {}), [item.id]: record } });
  }

  const status = input.action === "dont_know" ? "dont_know" as const : "answered" as const;
  const value = status === "dont_know" ? null : cleanValue(item, (input as { value: unknown }).value);
  if (status === "answered" && (value === null || isEmpty(value))) throw new AssessmentError("The answer is empty.");
  const hadAnswer = isAnswered(previous) && Boolean(previous!.first_at);
  record = {
    value,
    status,
    draft: null,
    first_value: hadAnswer ? previous!.first_value : value,
    first_status: hadAnswer ? previous!.first_status : status,
    first_at: hadAnswer ? previous!.first_at : now,
    history: [...(previous?.history ?? []), { value, status, at: now }].slice(-30),
    tries: (previous?.tries ?? 0) + (status === "answered" ? 1 : 0),
    updated_at: now,
  };
  return saveAttempt(admin, attempt, { answers: { ...(attempt.answers ?? {}), [item.id]: record } });
}

function isEmpty(value: AnswerValue): boolean {
  if (typeof value === "string") return !value.trim();
  if (Array.isArray(value)) return value.length === 0;
  return Object.values(value).every((v) => !String(v).trim());
}

/**
 * The recording for one section, as a short-lived link. Fetching it is free;
 * only an actual start of playback (startListen) spends a listening, so a
 * failed download never costs the learner one.
 */
export async function audioLink(admin: SupabaseClient, attempt: AttemptRow, sectionId: string) {
  const section = attempt.snapshot.content.sections.find((s) => s.id === sectionId);
  if (section?.stimulus?.type !== "audio") throw new AssessmentError("This section has no recording.", 404);
  const max = section.stimulus.max_plays;
  if (!isClosed(attempt) && max !== null && listensUsed(attempt, sectionId) >= max) {
    throw new AssessmentError("No listenings left.", 403);
  }
  if (isClosed(attempt) && max !== null) throw new AssessmentError("The test is finished.", 403);
  const { data: row } = await admin.from("assessment_audio").select("status, storage_path")
    .eq("assessment_id", attempt.assessment_id).eq("section_id", sectionId).maybeSingle();
  if (!row || row.status !== "ready" || !row.storage_path) throw new AssessmentError("The recording is still being prepared.", 425);
  const { data, error } = await admin.storage.from(AUDIO_BUCKET).createSignedUrl(row.storage_path as string, 300);
  if (error || !data) throw new AssessmentError(`audio link failed: ${error?.message ?? "no url"}`, 500);
  return data.signedUrl;
}

export async function startListen(admin: SupabaseClient, userId: string, attempt: AttemptRow, sectionId: string) {
  const section = attempt.snapshot.content.sections.find((s) => s.id === sectionId);
  if (section?.stimulus?.type !== "audio") throw new AssessmentError("This section has no recording.", 404);
  if (isSectionDone(attempt, sectionId)) throw new AssessmentError("This section is finished.", 409);
  const { data, error } = await admin.rpc("assessment_start_listen", {
    p_attempt: attempt.id,
    p_user: userId,
    p_section: sectionId,
    p_max: section.stimulus.max_plays,
  });
  if (error) throw new AssessmentError(`listen count failed: ${error.message}`, 500);
  const result = data as { ok: boolean; used?: number; reason?: string };
  if (!result.ok) throw new AssessmentError(result.reason === "limit_reached" ? "No listenings left." : "The test is closed.", 403);
  return result.used ?? 0;
}

export async function getLearnerAttempt(admin: SupabaseClient, userId: string, assessmentId: string): Promise<AttemptRow | null> {
  return latestAttempt(admin, userId, assessmentId);
}
