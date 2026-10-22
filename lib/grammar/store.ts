// The grammar trainers on the server: each trainer's standing config and the
// sessions a teacher assigns. Service-role client, always scoped by user id.

import type { SupabaseClient } from "@supabase/supabase-js";
import { CASE_LABEL, FAMILIES, FAMILY_LABEL } from "./common";
import { BLOCK_LABEL, BLOCKS, artCatalogue } from "./articles";
import { TRAINER_PATH, TRAINER_TITLE, defaultConfig, emptyReasons, normalizeConfig, validatePatch, validateSession, type GrammarConfig, type SessionSettings } from "./config";
import { ERROR_LABEL, ERROR_TYPES, MODES, MODE_LABEL, type TrainerId } from "./task";
import { SENTENCE_LABEL, VP_PREPOSITIONS, vpCatalogue } from "./verbPrepositions";

export function practiceLink(origin: string, trainer: TrainerId, sessionId: string): string {
  return `${origin.replace(/\/$/, "")}/practice/${TRAINER_PATH[trainer]}/${sessionId}`;
}

export async function readConfig(admin: SupabaseClient, userId: string, trainer: TrainerId): Promise<{ config: GrammarConfig; updated_at: string | null; updated_by: string | null }> {
  const { data, error } = await admin.from("grammar_trainer_config").select("config, updated_at, updated_by").eq("user_id", userId).eq("trainer", trainer).maybeSingle();
  if (error) throw new Error(`grammar config read failed: ${error.message}`);
  return { config: data ? normalizeConfig(trainer, data.config) : defaultConfig(trainer), updated_at: data?.updated_at ?? null, updated_by: data?.updated_by ?? null };
}

export async function writeConfig(admin: SupabaseClient, userId: string, trainer: TrainerId, patch: Record<string, unknown>, by: "learner" | "teacher") {
  const { config } = await readConfig(admin, userId, trainer);
  const result = validatePatch(trainer, config, patch);
  if (!result.ok) throw new Error(`Invalid ${trainer} settings: ${result.errors.join("; ")}`);
  const { error } = await admin.from("grammar_trainer_config").upsert({ user_id: userId, trainer, config: result.value, updated_by: by, updated_at: new Date().toISOString() });
  if (error) throw new Error(`grammar config write failed: ${error.message}`);
  return { trainer, config: result.value, previous: config, warnings: result.warnings, empty_reasons: emptyReasons(trainer, result.value) };
}

/** What can be switched on, for get_grammar_trainer_config. */
export function catalogueDescription(trainer: TrainerId) {
  const common = {
    trainer,
    title: TRAINER_TITLE[trainer],
    modes: MODES.map((m) => ({ id: m, label: MODE_LABEL[m] })),
    error_types: ERROR_TYPES.map((t) => ({ id: t, label: ERROR_LABEL[t] })),
    answer_kinds: {
      independent: "answered without help",
      assisted: "the cheat sheet was opened before answering — counted apart from independent answers",
      correction: "a second try after an error; the first answer is kept",
      technical: "speech or microphone failure, never an error",
      dont_know: "«Не знаю», counted as not right",
    },
  };
  if (trainer === "verb_prepositions") {
    return {
      ...common,
      unit: "One entry = a verb in one meaning with its government (sprechen mit and sprechen über are two entries).",
      combinations: vpCatalogue(),
      prepositions: VP_PREPOSITIONS,
      sentence_types: SENTENCE_LABEL,
      settings: {
        selection: "learned (the learned list) | manual (the manual list)",
        learned: "combination ids marked learned; learned_add / learned_remove change it without resending the list",
        manual: "combination ids for manual selection",
        prepositions: "only real combinations with these prepositions ([] = all); never attached to other verbs",
        cases: "acc, dat — the case of the object",
        include_no_prep: "mix in verbs without a preposition (sehen, hören, suchen, brauchen, anrufen, helfen…)",
        reflexive: "reflexive verbs (sich freuen auf / über, sich interessieren für, sich erinnern an, sich kümmern um)",
        separable: "separable verbs (anrufen, einladen, teilnehmen an, aufpassen auf)",
        modal: "sentences with können",
        sentence_types: "statement, question, negation",
        objects: "pronoun, noun",
        mode: "quick | build | written | spoken | mixed (build → written → quick)",
        set_size: "0 = endless; otherwise tasks per set",
      },
      limits: [
        "Tasks are built only from this catalogue; you choose settings and combinations, not sentences.",
        "Quick choice trains choosing the construction; it is reported apart from building, writing and speaking.",
        "In build mode two prepositions are always on the buttons, needed or not; not all buttons have to be used.",
        "Negation with a noun object without a preposition is not asked (it could be read as «kein»).",
        "Weak nouns and adjective endings are not used.",
      ],
    };
  }
  return {
    ...common,
    ...artCatalogue(),
    cases: CASE_LABEL,
    blocks: BLOCKS.map((b) => ({ id: b, label: BLOCK_LABEL[b] })),
    families: FAMILIES.map((f) => ({ id: f, label: FAMILY_LABEL[f] })),
    settings: {
      cases: "nom, acc, dat",
      dative_blocks: "dat_mit, dat_bei, dat_zu, dat_verbs (helfen, danken), dat_give (geben, schenken: Dativ + Akkusativ). Used only while dat is on; never switched on by turning on Dativ.",
      genders: "m, f, n, pl",
      families: "der, ein, kein, mein, dein, sein, ihr, unser, euer, Ihr",
      show_gender: "show the noun's article in the task",
      gaps: "one | two | mixed",
      selection: "learned | manual (frame ids)",
      mode: "quick | build | written | spoken | mixed",
      set_size: "0 = endless",
    },
    limits: [
      "Quick mode always names the determiner family («Используй ein») when the sentence does not decide it; den is not marked wrong just because ein was expected unless the task asked for ein.",
      "In build, written and spoken answers der and ein are both accepted wherever the Russian cannot tell them apart.",
      "Adjective endings and weak nouns are not part of this version.",
      "ein has no plural; the Dativ plural -n is explained with every Dativ plural task.",
    ],
  };
}

type SessionRow = { id: string; trainer: TrainerId; client_key: string | null; settings: SessionSettings; status: string; created_at: string; started_at: string | null; completed_at: string | null };

function describeSession(row: SessionRow, origin: string) {
  return { session_id: row.id, trainer: row.trainer, client_key: row.client_key, status: row.status, link: practiceLink(origin, row.trainer, row.id), settings: row.settings, created_at: row.created_at, started_at: row.started_at, completed_at: row.completed_at };
}

export async function createSession(admin: SupabaseClient, userId: string, trainer: TrainerId, raw: Record<string, unknown>, origin: string) {
  const { config } = await readConfig(admin, userId, trainer);
  const result = validateSession(trainer, config, raw);
  if (!result.ok) throw new Error(`Invalid session settings: ${result.errors.join("; ")}`);
  const settings = result.value;
  if (settings.client_key) {
    const { data } = await admin.from("grammar_trainer_sessions").select("*").eq("user_id", userId).eq("trainer", trainer).eq("client_key", settings.client_key).maybeSingle();
    if (data) return { ...describeSession(data as SessionRow, origin), duplicate: true, warnings: ["A session with this client_key already exists; it was returned unchanged."] };
  }
  const { data, error } = await admin.from("grammar_trainer_sessions").insert({ user_id: userId, trainer, client_key: settings.client_key, settings }).select("*").single();
  if (error) {
    if (settings.client_key && /duplicate|unique/i.test(error.message)) {
      const { data: existing } = await admin.from("grammar_trainer_sessions").select("*").eq("user_id", userId).eq("trainer", trainer).eq("client_key", settings.client_key).single();
      if (existing) return { ...describeSession(existing as SessionRow, origin), duplicate: true, warnings: [] };
    }
    throw new Error(`session create failed: ${error.message}`);
  }
  return { ...describeSession(data as SessionRow, origin), duplicate: false, warnings: result.warnings };
}

export async function listSessions(admin: SupabaseClient, userId: string, origin: string, opts: { trainer?: TrainerId; openOnly?: boolean } = {}) {
  let q = admin.from("grammar_trainer_sessions").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(30);
  if (opts.trainer) q = q.eq("trainer", opts.trainer);
  if (opts.openOnly) q = q.neq("status", "completed");
  const { data, error } = await q;
  if (error) throw new Error(`sessions read failed: ${error.message}`);
  return ((data ?? []) as SessionRow[]).map((r) => describeSession(r, origin));
}

export async function getSession(admin: SupabaseClient, userId: string, trainer: TrainerId, id: string, origin: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await admin.from("grammar_trainer_sessions").select("*").eq("user_id", userId).eq("trainer", trainer).eq("id", id).maybeSingle();
  return data ? describeSession(data as SessionRow, origin) : null;
}

export async function markSession(admin: SupabaseClient, userId: string, id: string, action: "start" | "complete") {
  const now = new Date().toISOString();
  const patch = action === "start" ? { status: "started", started_at: now } : { status: "completed", completed_at: now };
  let q = admin.from("grammar_trainer_sessions").update(patch).eq("user_id", userId).eq("id", id);
  if (action === "start") q = q.eq("status", "assigned");
  const { error } = await q;
  if (error) throw new Error(`session update failed: ${error.message}`);
}
