// One grammar-trainer answer as a training event: the shared history's
// fields, plus what the teacher needs in meta — the construction, how the
// answer was given (quick, build, written, spoken), whether it was the
// learner's own or with the cheat sheet open, a correction, or a technical
// problem, and each difference named by its kind.

import type { CheckResult, GrammarTask } from "./task";

export type RecordOutcome = CheckResult["outcome"] | "dont_know" | "technical";

/** independent: no help; assisted: the cheat sheet (or a hint) was open before answering; correction: a second try after an error. */
export type AnswerKind = "independent" | "assisted" | "correction" | "technical" | "dont_know";

export function answerKind(args: { outcome: RecordOutcome; correctionOf: string | null; helpUsed: boolean }): AnswerKind {
  if (args.outcome === "technical") return "technical";
  if (args.correctionOf) return "correction";
  if (args.outcome === "dont_know") return "dont_know";
  return args.helpUsed ? "assisted" : "independent";
}

export function grammarEventInput(task: GrammarTask, args: {
  sessionId: string;
  assignedSessionId: string | null;
  answer: string;
  outcome: RecordOutcome;
  result: CheckResult | null;
  attemptNo: number;
  correctionOf: string | null;
  helpUsed: boolean;
  answerShown: boolean;
  activeMs: number | null;
  testRun: boolean;
  speech?: { transcript: string; confidence: number | null; recognition_ms: number | null } | null;
  technicalReason?: string | null;
}) {
  const kind = answerKind({ outcome: args.outcome, correctionOf: args.correctionOf, helpUsed: args.helpUsed });
  const meta: Record<string, unknown> = {
    ...task.meta,
    task_id: task.id,
    template_version: task.template_version,
    key: task.key,
    key_label: task.key_label,
    response_mode: task.mode,
    answer_kind: kind,
    help_used: args.helpUsed,
    issues: args.result?.issues.map((i) => ({ type: i.type, expected: i.expected, answered: i.answered })) ?? [],
    error_types: [...new Set(args.result?.issues.filter((i) => i.type !== "typo").map((i) => i.type) ?? [])],
    typos: args.result?.issues.filter((i) => i.type === "typo").length ?? 0,
    feedback: args.result?.feedback ?? [],
    variant: args.result?.variant ?? null,
    uncertain_reason: args.result?.uncertain_reason ?? null,
    check_method: "rules",
    correction_of: args.correctionOf,
    repeat_of: task.repeat_of,
    delayed_review: task.delayed_review,
    assigned_session_id: args.assignedSessionId,
    active_ms: args.activeMs,
    speech: args.speech ?? null,
    technical_reason: args.technicalReason ?? null,
    // Developer checks never reach the learner's statistics.
    ...(args.testRun ? { test_run: true } : {}),
  };
  return {
    trainer: task.trainer,
    checks: task.trainer === "verb_prepositions" ? "verb_government" as const : "determiner" as const,
    outcome: args.outcome,
    word: task.key_label,
    mode: task.mode,
    sessionId: args.sessionId,
    form: task.key,
    prompt: [task.prompt_ru, task.notes_ru.length ? `(${task.notes_ru.join("; ")})` : null, task.quick ? task.quick.instruction.join(" ") : null].filter(Boolean).join(" "),
    answer: args.answer,
    expected: task.expected,
    attemptNo: args.attemptNo,
    hintUsed: args.helpUsed,
    answerShown: args.answerShown,
    meta,
  };
}
