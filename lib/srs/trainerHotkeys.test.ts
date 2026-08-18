import assert from "node:assert/strict";
import test from "node:test";
import { discussHotkey, isTypingTarget, trainerHotkey } from "./trainerHotkeys.ts";

type KeyLike = Pick<KeyboardEvent, "code" | "key" | "ctrlKey" | "metaKey" | "altKey">;

function press(code: string, key = code, modifiers: Partial<KeyLike> = {}): KeyLike {
  return { code, key, ctrlKey: false, metaKey: false, altKey: false, ...modifiers };
}

test("the keypad digits map onto the card the way the buttons are laid out", () => {
  assert.deepEqual(trainerHotkey(press("Numpad1", "1")), { kind: "grade", score: 1 });
  assert.deepEqual(trainerHotkey(press("Numpad4", "4")), { kind: "grade", score: 4 });
  assert.deepEqual(trainerHotkey(press("Numpad5", "5")), { kind: "speak" });
  assert.deepEqual(trainerHotkey(press("Numpad6", "6")), { kind: "flip" });
  assert.deepEqual(trainerHotkey(press("Numpad7", "7")), { kind: "story" });
  assert.deepEqual(trainerHotkey(press("Numpad8", "8")), { kind: "discuss" });
  assert.deepEqual(trainerHotkey(press("Numpad9", "9")), { kind: "speak" });
  assert.deepEqual(trainerHotkey(press("Numpad0", "0")), { kind: "live" });
});

test("a keypad with Num Lock off still grades instead of walking the history", () => {
  // This is the whole reason the mapping reads `code`: with Num Lock off the
  // browser reports the keypad's 4 and 6 as ArrowLeft and ArrowRight.
  assert.deepEqual(trainerHotkey(press("Numpad4", "ArrowLeft")), { kind: "grade", score: 4 });
  assert.deepEqual(trainerHotkey(press("Numpad6", "ArrowRight")), { kind: "flip" });
  assert.deepEqual(trainerHotkey(press("Numpad2", "ArrowDown")), { kind: "grade", score: 2 });
});

test("the real arrow keys walk the review history", () => {
  assert.deepEqual(trainerHotkey(press("ArrowLeft")), { kind: "historyOlder" });
  assert.deepEqual(trainerHotkey(press("ArrowRight")), { kind: "historyNewer" });
});

test("escape is the way out of a screen that has hidden everything else", () => {
  assert.deepEqual(trainerHotkey(press("Escape")), { kind: "zenExit" });
  // Escape is read after the digits, so nothing it was already doing changes.
  assert.deepEqual(trainerHotkey(press("Numpad1", "1")), { kind: "grade", score: 1 });
  assert.deepEqual(trainerHotkey(press("ArrowLeft")), { kind: "historyOlder" });
});

test("keyboards without a keypad work off the digit row", () => {
  assert.deepEqual(trainerHotkey(press("Digit3", "3")), { kind: "grade", score: 3 });
  // A layout whose code says nothing useful still reports the character.
  assert.deepEqual(trainerHotkey(press("", "6")), { kind: "flip" });
});

test("shortcuts never steal a browser or system combination", () => {
  assert.equal(trainerHotkey(press("Numpad1", "1", { ctrlKey: true })), null);
  assert.equal(trainerHotkey(press("Digit1", "1", { metaKey: true })), null);
  assert.equal(trainerHotkey(press("ArrowLeft", "ArrowLeft", { altKey: true })), null);
});

test("keys the trainer has no use for are left alone", () => {
  assert.equal(trainerHotkey(press("KeyA", "a")), null);
  assert.equal(trainerHotkey(press("Space", " ")), null);
});

test("the keypad's plus asks the engine for the recording again", () => {
  // The card grew a «переозвучить» button; the pad grew the key beside the
  // digits that presses it.
  assert.deepEqual(trainerHotkey(press("NumpadAdd", "+")), { kind: "respeak" });
  assert.deepEqual(trainerHotkey(press("Equal", "+")), { kind: "respeak" });
  assert.equal(trainerHotkey(press("NumpadAdd", "+", { ctrlKey: true })), null);
});

test("while the player is open, two of the grades drive the player instead", () => {
  const playing = { playerOpen: true };
  assert.deepEqual(trainerHotkey(press("Numpad2", "2"), playing), { kind: "playerRepeat" });
  assert.deepEqual(trainerHotkey(press("Numpad3", "3"), playing), { kind: "playerClose" });
  // Everything else still belongs to the card.
  assert.deepEqual(trainerHotkey(press("Numpad1", "1"), playing), { kind: "grade", score: 1 });
  assert.deepEqual(trainerHotkey(press("Numpad4", "4"), playing), { kind: "grade", score: 4 });
  assert.deepEqual(trainerHotkey(press("Numpad6", "6"), playing), { kind: "flip" });
  // And they are grades again the moment it closes.
  assert.deepEqual(trainerHotkey(press("Numpad2", "2")), { kind: "grade", score: 2 });
});

test("the discussion modal answers to the same pad, laid out the way it looks", () => {
  assert.deepEqual(discussHotkey(press("Numpad1", "1")), { kind: "suggestion", index: 0 });
  assert.deepEqual(discussHotkey(press("Numpad2", "2")), { kind: "suggestion", index: 1 });
  assert.deepEqual(discussHotkey(press("Digit3", "3")), { kind: "suggestion", index: 2 });
  assert.deepEqual(discussHotkey(press("Numpad4", "4")), { kind: "forms" });
  assert.deepEqual(discussHotkey(press("Numpad5", "5")), { kind: "mic" });
  assert.deepEqual(discussHotkey(press("Numpad9", "9")), { kind: "close" });
  assert.deepEqual(discussHotkey(press("Escape")), { kind: "close" });
  // Keys the modal has nothing for are left to the browser.
  assert.equal(discussHotkey(press("Numpad7", "7")), null);
  assert.equal(discussHotkey(press("KeyA", "a")), null);
  assert.equal(discussHotkey(press("Digit1", "1", { metaKey: true })), null);
});

test("typing into a field is never treated as a shortcut", () => {
  // Without this the search box on the same screen would swallow every digit.
  const tags = ["INPUT", "TEXTAREA", "SELECT"];
  for (const tagName of tags) {
    assert.equal(isTypingTarget({ tagName, isContentEditable: false } as unknown as EventTarget), true, tagName);
  }
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: true } as unknown as EventTarget), true);
  assert.equal(isTypingTarget({ tagName: "DIV", isContentEditable: false } as unknown as EventTarget), false);
  assert.equal(isTypingTarget(null), false);
});
