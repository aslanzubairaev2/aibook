// Keyboard control for the recognize trainer.
//
// A review session is a long run of identical decisions, and reaching for the
// mouse between every one of them is most of the effort. The numeric keypad
// already reads like the card: the four grade buttons carry the digits 1–4, so
// those keys are the grades, and the rest of the pad covers what is left on the
// card in the order the buttons sit in.

export type TrainerAction =
  | { kind: "grade"; score: 1 | 2 | 3 | 4 }
  | { kind: "speak" }
  | { kind: "flip" }
  | { kind: "story" }
  | { kind: "discuss" }
  | { kind: "historyOlder" }
  | { kind: "historyNewer" }
  | { kind: "live" }
  | { kind: "zenExit" };

const BY_DIGIT: Record<string, TrainerAction> = {
  "1": { kind: "grade", score: 1 },
  "2": { kind: "grade", score: 2 },
  "3": { kind: "grade", score: 3 },
  "4": { kind: "grade", score: 4 },
  "5": { kind: "speak" },
  "6": { kind: "flip" },
  "7": { kind: "story" },
  "8": { kind: "discuss" },
  // The card's speaker and the top row's speaker voice the same thing — the
  // word in the language being learned — so both keys land on one action
  // rather than inventing a difference the buttons do not have.
  "9": { kind: "speak" },
  "0": { kind: "live" },
};

/**
 * Resolves a key press to a trainer action, or null to let it through.
 *
 * `code` is what actually identifies a keypad key: with Num Lock off the
 * browser reports Numpad4 as the "ArrowLeft" key while keeping the code, so
 * reading `key` alone would turn a grade into a history step. The top-row
 * digits are accepted too, through `key`, for keyboards with no pad at all.
 */
export function trainerHotkey(event: Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "altKey">): TrainerAction | null {
  // Anything with a modifier belongs to the browser or the OS.
  if (event.ctrlKey || event.metaKey || event.altKey) return null;

  const numpad = /^Numpad([0-9])$/.exec(event.code);
  if (numpad) return BY_DIGIT[numpad[1]] ?? null;

  const digitRow = /^Digit([0-9])$/.exec(event.code);
  if (digitRow) return BY_DIGIT[digitRow[1]] ?? null;

  // The way out of a screen that has hidden everything else — the key every
  // full-screen view is already expected to answer to.
  if (event.code === "Escape" || event.key === "Escape") return { kind: "zenExit" };

  if (event.code === "ArrowLeft" || event.key === "ArrowLeft") return { kind: "historyOlder" };
  if (event.code === "ArrowRight" || event.key === "ArrowRight") return { kind: "historyNewer" };

  // Layouts where the code says nothing useful (and keyboards without a row of
  // coded digits) still report the character.
  if (/^[0-9]$/.test(event.key)) return BY_DIGIT[event.key] ?? null;

  return null;
}

/**
 * Whether the key press belongs to something the learner is typing into.
 *
 * The trainer shares a screen with a search field, a chat and a word lookup;
 * swallowing digits there would make those unusable.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  // Read off the element rather than testing `instanceof HTMLElement`: that
  // check answers "which realm did this come from" as much as "is this an
  // element", and gets it wrong for anything inside a frame.
  const element = target as { tagName?: unknown; isContentEditable?: unknown } | null;
  if (!element) return false;
  if (element.isContentEditable === true) return true;
  return element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT";
}
