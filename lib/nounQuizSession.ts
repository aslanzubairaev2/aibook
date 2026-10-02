/**
 * A noun quiz session as it is kept between visits: the order the questions
 * were dealt in and what was answered. Only step keys are stored — the steps
 * themselves are rebuilt from the dictionary, so an edited word shows up
 * edited, and a deleted one simply drops out. The score and the mistakes are
 * not stored either: both are just the answers, counted.
 */
export type SavedNounQuizSession<A> = {
  stepKeys: string[];
  answers: Record<string, A>;
  /** The «Повторить ошибки» round: its queue is the mistakes only, so new words must not be added to it. */
  retry: boolean;
};

export type RestoredNounQuizSession<T, A> = {
  queue: T[];
  index: number;
  answers: Record<string, A>;
  mistakes: T[];
  correctCount: number;
  retry: boolean;
};

/**
 * Lays a saved session over the steps the dictionary produces today.
 *
 * The saved order is kept, so the strip of ticks looks exactly as it was left.
 * Steps that no longer exist drop out with their answers; steps that are new
 * since (a word added to the pack, a drill switched on) go to the end, still
 * in the freshly scheduled order. The cursor lands on the first unanswered
 * question rather than a saved index, which would point at the wrong card
 * once anything above it dropped out.
 *
 * Returns null when there is nothing worth resuming, so the caller starts a
 * fresh session.
 */
export function restoreNounQuizSession<T extends { key: string }, A extends { ok: boolean }>(
  fresh: T[],
  saved: SavedNounQuizSession<A> | null,
): RestoredNounQuizSession<T, A> | null {
  if (!saved || saved.stepKeys.length === 0) return null;
  const byKey = new Map(fresh.map((step) => [step.key, step]));
  const kept = saved.stepKeys.flatMap((key) => {
    const step = byKey.get(key);
    return step ? [step] : [];
  });
  const keptKeys = new Set(kept.map((step) => step.key));
  const added = saved.retry ? [] : fresh.filter((step) => !keptKeys.has(step.key));
  const queue = [...kept, ...added];

  const answers: Record<string, A> = {};
  for (const step of kept) {
    const answer = saved.answers[step.key];
    if (answer) answers[step.key] = answer;
  }
  // A fresh full round with nothing answered is not worth resuming — dealing
  // it again costs nothing. A retry round is: starting over would turn it
  // back into the whole pack.
  if (!saved.retry && Object.keys(answers).length === 0) return null;
  if (queue.length === 0) return null;

  const index = queue.findIndex((step) => !answers[step.key]);
  // Everything answered means the session was finished — start over instead
  // of reopening on the summary.
  if (index === -1) return null;

  return {
    queue,
    index,
    answers,
    mistakes: kept.filter((step) => answers[step.key] && !answers[step.key].ok),
    correctCount: Object.values(answers).filter((answer) => answer.ok).length,
    retry: saved.retry,
  };
}
