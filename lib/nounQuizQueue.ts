/**
 * Spread repeated drills for one noun throughout a session. Each noun keeps
 * its own drill order, while its next turn is due roughly one session-length
 * divided by its number of drills after the previous one.
 */
export function scheduleNounQuizSteps<T extends { entry: { id: string } }>(steps: T[]): T[] {
  const byNoun = new Map<string, T[]>();
  for (const step of steps) {
    const group = byNoun.get(step.entry.id);
    if (group) group.push(step);
    else byNoun.set(step.entry.id, [step]);
  }

  // Shuffle ties so sessions do not always start with the same noun. Nouns
  // with more drills go first: they need the earliest slots to fit apart.
  const shuffled = [...byNoun.entries()];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const groups = shuffled
    .sort((a, b) => b[1].length - a[1].length)
    .map(([id, items], rank, all) => {
      const interval = steps.length / items.length;
      return { id, items, next: 0, due: (rank / all.length) * interval, interval };
    });

  const scheduled: T[] = [];
  let previousId: string | undefined;
  while (scheduled.length < steps.length) {
    let chosen: (typeof groups)[number] | undefined;
    for (const group of groups) {
      if (group.next >= group.items.length || group.id === previousId) continue;
      if (!chosen || group.due < chosen.due) chosen = group;
    }
    // A deck with only one noun left cannot put another word between repeats.
    if (!chosen) chosen = groups.find((group) => group.next < group.items.length);
    if (!chosen) break;
    scheduled.push(chosen.items[chosen.next++]);
    chosen.due += chosen.interval;
    previousId = chosen.id;
  }
  return scheduled;
}
