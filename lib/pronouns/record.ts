// One pronoun answer as a training event: the shared history's fields, plus
// everything the brief asks to keep in meta — the task and its version, the
// target participants by person/number/gender/case, the per-part verdicts,
// the first answer apart from corrections, speech data apart from grammar.

import { PRONOUNS, VERB_BY_ID, type PronounId } from "./catalog";
import type { CheckResult } from "./check";
import type { PronounTask } from "./tasks";
import type { PronounMeta } from "./stats";

export type RecordOutcome = CheckResult["outcome"] | "dont_know" | "skipped" | "technical";

function participant(id: PronounId, kase: "nom" | "acc") {
  const p = PRONOUNS[id];
  return { id, person: p.person, number: p.number, gender: p.gender, polite: p.polite, case: kase, form: kase === "nom" ? p.nom : p.acc };
}

export function pronounEventInput(task: PronounTask, args: {
  sessionId: string;
  assignedSessionId: string | null;
  answer: string;
  outcome: RecordOutcome;
  result: CheckResult | null;
  attemptNo: number;
  correctionOf: string | null;
  hintUsed: boolean;
  answerShown: boolean;
  activeMs: number | null;
  speech?: PronounMeta["speech"];
  technicalReason?: string | null;
}) {
  const verb = VERB_BY_ID[task.verb];
  const meta: PronounMeta & Record<string, unknown> = {
    task_id: task.id,
    template_version: task.template_version,
    kind: task.kind,
    verb: task.verb,
    noun: task.noun,
    constructions: task.constructions,
    sentence_type: task.sentenceType,
    modal: task.modal,
    response_mode: task.mode,
    focus_role: task.focus_role,
    difficulty: task.difficulty,
    case: "accusative",
    target: { subject: participant(task.subject, "nom"), object: participant(task.object, "acc") },
    expected_forms: { subject: PRONOUNS[task.subject].nom, object: PRONOUNS[task.object].acc, sentence: task.expected },
    blanks: task.blanks,
    context_de: task.context_de,
    components: args.result?.components,
    confusions: args.result?.confusions,
    error_kind: args.result?.error_kind ?? null,
    agreement_ok: args.result?.agreement_ok ?? null,
    answered: args.result?.answered,
    feedback: args.result?.feedback,
    uncertain_reason: args.result?.uncertain_reason ?? null,
    check_method: "rules",
    correction_of: args.correctionOf,
    delayed_review: task.delayed_review,
    recheck_of: task.recheck_of,
    followup_of: task.followup_of,
    assigned_session_id: args.assignedSessionId,
    active_ms: args.activeMs,
    speech: args.speech ?? null,
    technical_reason: args.technicalReason ?? null,
  };
  return {
    trainer: "pronouns" as const,
    checks: "pronoun" as const,
    outcome: args.outcome,
    word: verb.preposition ? `${verb.infinitive} ${verb.preposition}` : verb.infinitive,
    mode: task.mode,
    sessionId: args.sessionId,
    form: task.constructions.join("+"),
    pronoun: `${task.subject}>${task.object}`,
    prompt: [task.context_de, task.prompt_ru, task.notes_ru.length ? `(${task.notes_ru.join("; ")})` : null].filter(Boolean).join(" "),
    answer: args.answer,
    expected: task.expected,
    attemptNo: args.attemptNo,
    hintUsed: args.hintUsed,
    answerShown: args.answerShown,
    meta,
  };
}
