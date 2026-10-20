// Pronoun practice on the server: the standing config, sessions a teacher
// assigns, re-grades of an automatic verdict, and the history read back for
// the summary. Service-role client, always scoped by user id.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CONSTRUCTIONS,
  CONSTRUCTION_LABEL,
  LEVELS,
  MODE_LABEL,
  NOUNS,
  PRONOUNS,
  PRONOUN_IDS,
  RESPONSE_MODES,
  TEMPLATE_VERSION,
  VERBS,
} from "./catalog";
import { COMPONENTS, COMPONENT_LABEL } from "./check";
import { DEFAULT_CONFIG, FOCUSES, PLANNED_CASES, SUPPORTED_CASES, normalizeConfig, parsePronoun, validateConfigPatch, validateSessionSettings, type PronounConfig, type SessionSettings } from "./config";
import type { AnswerReview, PronounFilters } from "./stats";

export function practiceLink(origin: string, sessionId: string): string {
  return `${origin.replace(/\/$/, "")}/practice/pronouns/${sessionId}`;
}

export async function readConfig(admin: SupabaseClient, userId: string): Promise<{ config: PronounConfig; updated_at: string | null; updated_by: string | null }> {
  const { data, error } = await admin.from("pronoun_practice_config").select("config, updated_at, updated_by").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`pronoun config read failed: ${error.message}`);
  return { config: data ? normalizeConfig(data.config) : DEFAULT_CONFIG, updated_at: data?.updated_at ?? null, updated_by: data?.updated_by ?? null };
}

export async function writeConfig(admin: SupabaseClient, userId: string, patch: Record<string, unknown>, by: "learner" | "teacher") {
  const { config } = await readConfig(admin, userId);
  const result = validateConfigPatch(config, patch);
  if (!result.ok) throw new Error(`Invalid pronoun practice settings: ${result.errors.join("; ")}`);
  const { error } = await admin.from("pronoun_practice_config").upsert({ user_id: userId, config: result.value, updated_by: by, updated_at: new Date().toISOString() });
  if (error) throw new Error(`pronoun config write failed: ${error.message}`);
  return { config: result.value, previous: config, warnings: result.warnings };
}

/** What can be switched on, for get_pronoun_practice_config. */
export function catalogueDescription() {
  return {
    template_version: TEMPLATE_VERSION,
    cases: { supported: SUPPORTED_CASES, planned_not_enabled: PLANNED_CASES },
    pronouns: PRONOUN_IDS.map((id) => ({ id, nominative: PRONOUNS[id].nom, accusative: PRONOUNS[id].acc, meaning: PRONOUNS[id].label })),
    pronoun_aliases: "target_pronouns also accept accusative forms and brief names: uns, euch, sie_plural, sie_polite…",
    constructions: CONSTRUCTIONS.map((c) => ({ id: c, label: CONSTRUCTION_LABEL[c] })),
    levels: LEVELS,
    response_modes: RESPONSE_MODES.map((m) => ({ id: m, label: MODE_LABEL[m] })),
    focus: FOCUSES,
    verbs: VERBS.map((v) => ({
      id: v.id, infinitive: v.infinitive, translation: v.ru, separable_prefix: v.prefix, preposition: v.preposition,
      case: v.case, objects: v.objects, sentence_types: v.sentenceTypes, with_modal: v.modal, government_note: v.governmentNote ?? null,
    })),
    nouns_for_replacement: NOUNS.map((n) => ({ noun: `${n.gender === "m" ? "der" : n.gender === "f" ? "die" : n.gender === "n" ? "das" : "die (pl)"} ${n.de}`, translation: n.ru })),
    answer_components: COMPONENTS.map((c) => ({ id: c, label: COMPONENT_LABEL[c] })),
    limits: [
      "Only Akkusativ in this version. Dative is planned and never switched on by itself.",
      "No reflexive pronouns (sich), no weak noun declension.",
      "A task is drawn only when every block it needs is on: a separable verb needs «separable» even inside a noun task; warten needs «prep_auf».",
      "Things-only verbs (prüfen, reparieren, kaufen, mitbringen, mitnehmen) need «noun_replacement»; reparieren is never used with people.",
      "Tasks are built from this catalogue only; you choose settings and difficulties, not sentences.",
    ],
  };
}

type SessionRow = { id: string; client_key: string | null; settings: SessionSettings; status: string; created_at: string; started_at: string | null; completed_at: string | null };

function describeSession(row: SessionRow, origin: string) {
  return { session_id: row.id, client_key: row.client_key, status: row.status, link: practiceLink(origin, row.id), settings: row.settings, created_at: row.created_at, started_at: row.started_at, completed_at: row.completed_at };
}

export async function createSession(admin: SupabaseClient, userId: string, raw: Record<string, unknown>, origin: string) {
  const { config } = await readConfig(admin, userId);
  const result = validateSessionSettings(config, raw);
  if (!result.ok) throw new Error(`Invalid session settings: ${result.errors.join("; ")}`);
  const settings = result.value;
  if (settings.client_key) {
    const { data } = await admin.from("pronoun_practice_sessions").select("*").eq("user_id", userId).eq("client_key", settings.client_key).maybeSingle();
    if (data) return { ...describeSession(data as SessionRow, origin), duplicate: true, warnings: ["A session with this client_key already exists; it was returned unchanged."] };
  }
  const { data, error } = await admin.from("pronoun_practice_sessions").insert({ user_id: userId, client_key: settings.client_key, settings }).select("*").single();
  if (error) {
    // Two calls racing on one client_key: the unique index decides, the loser reads the winner.
    if (settings.client_key && /duplicate|unique/i.test(error.message)) {
      const { data: existing } = await admin.from("pronoun_practice_sessions").select("*").eq("user_id", userId).eq("client_key", settings.client_key).single();
      if (existing) return { ...describeSession(existing as SessionRow, origin), duplicate: true, warnings: [] };
    }
    throw new Error(`session create failed: ${error.message}`);
  }
  return { ...describeSession(data as SessionRow, origin), duplicate: false, warnings: result.warnings };
}

export async function listSessions(admin: SupabaseClient, userId: string, origin: string, openOnly = false) {
  let q = admin.from("pronoun_practice_sessions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
  if (openOnly) q = q.neq("status", "completed");
  const { data, error } = await q;
  if (error) throw new Error(`sessions read failed: ${error.message}`);
  return ((data ?? []) as SessionRow[]).map((r) => describeSession(r, origin));
}

export async function getSession(admin: SupabaseClient, userId: string, id: string, origin: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("pronoun_practice_sessions").select("*").eq("user_id", userId).eq("id", id).maybeSingle();
  return data ? describeSession(data as SessionRow, origin) : null;
}

export async function markSession(admin: SupabaseClient, userId: string, id: string, action: "start" | "complete") {
  const now = new Date().toISOString();
  const patch = action === "start" ? { status: "started", started_at: now } : { status: "completed", completed_at: now };
  let q = admin.from("pronoun_practice_sessions").update(patch).eq("user_id", userId).eq("id", id);
  // Starting again never reopens a finished session.
  if (action === "start") q = q.eq("status", "assigned");
  const { error } = await q;
  if (error) throw new Error(`session update failed: ${error.message}`);
}

export async function readReviews(admin: SupabaseClient, userId: string): Promise<AnswerReview[]> {
  const { data, error } = await admin.from("training_event_reviews").select("event_id, outcome, components, note, reviewer, created_at").eq("user_id", userId).order("created_at").limit(5000);
  if (error) return [];
  return (data ?? []) as AnswerReview[];
}

const REVIEW_OUTCOMES = ["correct", "typo", "incorrect", "dont_know", "skipped", "technical", "needs_review"];

export async function reviewAnswer(admin: SupabaseClient, userId: string, args: Record<string, unknown>) {
  const eventId = typeof args.event_id === "string" ? args.event_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) throw new Error("event_id must be the event id from get_training_history (field event_id)");
  const { data: event, error } = await admin.from("training_events").select("id, trainer, outcome, meta, answer, expected, prompt").eq("user_id", userId).eq("id", eventId).maybeSingle();
  if (error) throw new Error(`event read failed: ${error.message}`);
  if (!event) throw new Error("No such training event for this learner.");
  if (event.trainer !== "pronouns") throw new Error("Only pronoun practice answers can be re-graded with this tool.");
  const outcome = args.outcome === undefined ? null : String(args.outcome);
  if (outcome !== null && !REVIEW_OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of ${REVIEW_OUTCOMES.join(", ")}`);
  let components: Record<string, string> | null = null;
  if (args.components !== undefined) {
    if (typeof args.components !== "object" || args.components === null || Array.isArray(args.components)) throw new Error("components must be an object like {\"object\": \"correct\"}");
    components = {};
    for (const [k, v] of Object.entries(args.components as Record<string, unknown>)) {
      if (!(COMPONENTS as readonly string[]).includes(k)) throw new Error(`unknown component «${k}». Known: ${COMPONENTS.join(", ")}`);
      if (!["correct", "error", "typo"].includes(String(v))) throw new Error(`component ${k}: use correct, error or typo`);
      components[k] = String(v);
    }
  }
  if (outcome === null && components === null) throw new Error("Give an outcome, components, or both.");
  const note = typeof args.note === "string" && args.note.trim() ? args.note.trim().slice(0, 1000) : null;
  const { error: insertError } = await admin.from("training_event_reviews").insert({ user_id: userId, event_id: eventId, outcome, components, note, reviewer: "teacher" });
  if (insertError) throw new Error(`review write failed: ${insertError.message}`);
  const { data: history } = await admin.from("training_event_reviews").select("outcome, components, note, reviewer, created_at").eq("event_id", eventId).order("created_at");
  return {
    event_id: eventId,
    automatic: { outcome: event.outcome, components: (event.meta as Record<string, unknown>)?.components ?? null },
    answer: event.answer,
    expected: event.expected,
    reviews: history ?? [],
    note: "The automatic verdict is kept; get_training_summary now counts the latest review.",
  };
}

/** Pronoun filters as they come over MCP, checked. */
export function pronounFilters(args: Record<string, unknown>): PronounFilters {
  const f: PronounFilters = {};
  if (typeof args.case === "string") f.case = args.case;
  if (typeof args.response_mode === "string" && (RESPONSE_MODES as readonly string[]).includes(args.response_mode)) f.response_mode = args.response_mode;
  if (typeof args.construction === "string" && (CONSTRUCTIONS as readonly string[]).includes(args.construction)) f.construction = args.construction;
  if (typeof args.verb === "string") {
    const v = VERBS.find((x) => x.id === args.verb || x.infinitive === args.verb || (x.preposition && `${x.infinitive} ${x.preposition}` === args.verb));
    if (v) f.verb = v.id;
  }
  if (args.role === "subject" || args.role === "object") f.role = args.role;
  const p = parsePronoun(args.pronoun);
  if (p) f.pronoun = p;
  return f;
}
