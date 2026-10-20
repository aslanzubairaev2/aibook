import type { ConjugationTense } from "@/lib/verbsQuizModes";

/** One blitz question: a single person of a single tense of a single verb. */
export type BlitzCell = {
  /** `${entryId}:${tense}:${person}` — unique within one deck. */
  key: string;
  entryId: string;
  verb: string;
  translation?: string;
  tense: ConjugationTense;
  /** «ich», «du», «er/sie/es»… — the row label the table already carries. */
  person: string;
  /** May hold alternatives as «habe geschwommen / bin geschwommen». */
  expected: string;
};

export type BlitzVerb = { id: string; verb: string; translation?: string };
export type BlitzRow = { label: string; form: string };

/**
 * Every cell the device can already answer for these verbs and tenses.
 * `rowsFor` returns a tense's table from what is stored on the device, or
 * null — a verb/tense with no table is simply left out: the blitz never asks
 * the AI. Cells that only repeat the infinitive (wir/sie machen) teach
 * nothing at speed and are dropped too.
 */
export function buildBlitzCells(
  verbs: BlitzVerb[],
  tenses: ConjugationTense[],
  rowsFor: (verbId: string, tense: ConjugationTense) => BlitzRow[] | null,
  isTrivial: (verbId: string, tense: ConjugationTense, row: BlitzRow) => boolean = () => false,
): BlitzCell[] {
  const cells: BlitzCell[] = [];
  for (const verb of verbs) {
    for (const tense of tenses) {
      const rows = rowsFor(verb.id, tense);
      if (!rows) continue;
      rows.forEach((row, person) => {
        if (!row.form.trim() || isTrivial(verb.id, tense, row)) return;
        cells.push({
          key: `${verb.id}:${tense}:${person}`,
          entryId: verb.id,
          verb: verb.verb,
          translation: verb.translation,
          tense,
          person: row.label,
          expected: row.form.trim(),
        });
      });
    }
  }
  return cells;
}

/**
 * Shuffles the cells so the same verb does not come twice in a row when
 * there is any other verb to put between — «du fährst» right after «ich
 * fahre» is recall of the previous answer, not of the verb.
 */
export function shuffleBlitzDeck(cells: BlitzCell[], random: () => number = Math.random): BlitzCell[] {
  const pool = [...cells];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  // Always draw from the verb with the most cells left (other than the one
  // just asked): taking the first other verb instead runs one verb dry early
  // and leaves the end of the deck as a block of a single verb.
  const left = new Map<string, number>();
  for (const cell of pool) left.set(cell.entryId, (left.get(cell.entryId) ?? 0) + 1);
  const deck: BlitzCell[] = [];
  while (pool.length) {
    const previous = deck.at(-1)?.entryId;
    let index = -1;
    for (let i = 0; i < pool.length; i++) {
      const id = pool[i].entryId;
      if (id === previous) continue;
      if (index === -1 || left.get(id)! > left.get(pool[index].entryId)!) index = i;
    }
    const [cell] = pool.splice(index === -1 ? 0 : index, 1);
    left.set(cell.entryId, left.get(cell.entryId)! - 1);
    deck.push(cell);
  }
  return deck;
}

export const BLITZ_SECONDS = 60;
