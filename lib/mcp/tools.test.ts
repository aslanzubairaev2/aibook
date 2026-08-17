// The failure this guards against is the one that actually happened: a feature
// shipped in the app, and the connected agent never learned it existed.
//
// Nothing here touches a database. It checks that what the server *advertises*
// stays in step with what it can do — tools with handlers, handlers with tools,
// and both with the capability map that the instructions, the guide resource
// and get_capabilities are all built from.

import assert from "node:assert/strict";
import test from "node:test";
import {
  MCP_TOOLS,
  buildGuideMarkdown,
  callMcpTool,
  directionProgress,
  findRegistryDrift,
  isDueToday,
  isStrugglingProgress,
  summarizeDeck,
} from "./tools.ts";
import { CAPABILITY_AREAS, buildInstructions } from "./capabilities.ts";
import { MCP_PROMPTS, getPrompt } from "./prompts.ts";

test("every tool is implemented, listed and described in the capability map", () => {
  assert.deepEqual(findRegistryDrift(), []);
});

test("tool definitions carry what a client needs to display and trust them", () => {
  for (const tool of MCP_TOOLS) {
    assert.match(tool.name, /^[a-z][a-z0-9_]*$/, `${tool.name}: snake_case name`);
    assert.ok(tool.title, `${tool.name}: needs a human-readable title`);
    assert.ok(
      tool.description.length > 60,
      `${tool.name}: description too thin to tell an agent when to use it`,
    );
    assert.equal(tool.inputSchema.type, "object", `${tool.name}: input schema must be an object`);
    assert.ok(tool.annotations, `${tool.name}: needs annotations so clients can tell reads from writes`);
    assert.equal(typeof tool.annotations?.readOnlyHint, "boolean", `${tool.name}: readOnlyHint`);
  }
});

test("required arguments exist among the declared properties", () => {
  for (const tool of MCP_TOOLS) {
    const properties = Object.keys((tool.inputSchema.properties ?? {}) as Record<string, unknown>);
    const required = (tool.inputSchema.required ?? []) as string[];
    for (const name of required) {
      assert.ok(properties.includes(name), `${tool.name}: required '${name}' is not a declared property`);
    }
  }
});

test("write tools are named as writes, and only deletion is destructive", () => {
  const destructive = MCP_TOOLS.filter((t) => t.annotations?.destructiveHint).map((t) => t.name);
  assert.deepEqual(destructive, ["delete_flashcards"]);

  for (const tool of MCP_TOOLS) {
    if (tool.annotations?.readOnlyHint) continue;
    assert.match(
      tool.name,
      /^(add|create|update|delete)_/,
      `${tool.name}: a tool that changes the learner's data should say so in its name`,
    );
  }
});

test("a themed set of cards can be filed as a pack, not left loose", () => {
  const addCards = MCP_TOOLS.find((t) => t.name === "add_flashcards");
  const properties = (addCards?.inputSchema.properties ?? {}) as Record<string, unknown>;

  // Without this the only way an agent could group phrases was a source name,
  // which the app showed nowhere the learner could act on.
  assert.ok(properties.batch_title, "add_flashcards must be able to put its cards in a pack");
  assert.ok(properties.training, "a pack made this way must be able to carry its training setup");
});

test("a pack's training setup covers every direction the trainer has", () => {
  const tool = MCP_TOOLS.find((t) => t.name === "update_batch_training");
  assert.ok(tool, "packs must be configurable over MCP");

  const properties = (tool!.inputSchema.properties ?? {}) as Record<string, Record<string, never>>;
  const variants = properties.variants as unknown as { items?: { enum?: string[] } };
  assert.deepEqual(variants.items?.enum, ["forward", "reverse", "audio"]);
  // Clearing has to be possible, or a pack could never go back to the
  // learner's own filters.
  assert.ok(properties.reset, "a pack's setup must be clearable");
  // Identifying a pack by title is what lets a group of cards become one.
  assert.ok(properties.title);
  assert.ok(properties.batch_id);
});

test("an unknown tool name comes back with the list of real ones", async () => {
  await assert.rejects(
    () => callMcpTool({} as never, "user", "make_coffee", {}),
    (err: Error) => err.message.includes("make_coffee") && err.message.includes("get_overview"),
  );
});

test("the instructions name every tool the server has", () => {
  const instructions = buildInstructions();
  for (const tool of MCP_TOOLS) {
    assert.ok(instructions.includes(tool.name), `instructions never mention ${tool.name}`);
  }
});

test("the guide resource describes every area and every tool", () => {
  const guide = buildGuideMarkdown();
  for (const area of CAPABILITY_AREAS) {
    assert.ok(guide.includes(area.area), `guide is missing the area ${area.area}`);
  }
  for (const tool of MCP_TOOLS) {
    assert.ok(guide.includes(`\`${tool.name}\``), `guide never mentions ${tool.name}`);
  }
});

test("prompts build a usable request and only mention tools that exist", () => {
  const toolNames = MCP_TOOLS.map((t) => t.name);
  for (const prompt of MCP_PROMPTS) {
    assert.ok(prompt.title, `${prompt.name}: needs a title the learner can read`);
    const text = prompt.build({});
    assert.ok(text.length > 80, `${prompt.name}: prompt text too thin`);
    for (const mentioned of text.match(/\b[a-z][a-z0-9_]*_[a-z0-9_]+\b/g) ?? []) {
      if (mentioned.startsWith("get_") || mentioned.startsWith("list_") || mentioned.startsWith("add_")
        || mentioned.startsWith("create_") || mentioned.startsWith("update_") || mentioned.startsWith("delete_")
        || mentioned.startsWith("search_")) {
        assert.ok(toolNames.includes(mentioned), `${prompt.name}: refers to a tool that does not exist: ${mentioned}`);
      }
    }
  }
});

// ─── The deck, counted the way the app counts it ────────────────────────────
//
// The numbers an agent quotes end up next to the numbers on the learner's own
// screen, so these pin the two together: due by end of day, three prompts per
// card, and "struggling" meaning what the app's «Сложные» filter means.

const NOW = new Date("2026-08-14T09:00:00.000Z");

function card(over: Record<string, unknown> = {}) {
  return {
    id: "card-1",
    front: "die Haltestelle",
    back: "остановка",
    status: "review",
    repetitions: 4,
    lapses: 0,
    easiness_factor: 2.5,
    interval_days: 30,
    next_review_at: "2026-09-01T00:00:00.000Z",
    last_reviewed_at: "2026-08-14T06:00:00.000Z",
    source_book_id: null,
    source_book_title: null,
    selection_type: "word",
    cefr: "A2",
    ...over,
  } as Parameters<typeof summarizeDeck>[0][number];
}

test("a card falling due later today is due, not tomorrow's problem", () => {
  const later = card({ next_review_at: "2026-08-14T22:00:00.000Z" });
  const [forward] = directionProgress([later], []);
  const endOfDay = Date.parse("2026-08-14T23:59:59.999Z");
  assert.equal(isDueToday(forward, endOfDay), true);
});

test("a direction the learner has never been asked in counts as due", () => {
  const progress = directionProgress([card()], []);
  const endOfDay = Date.parse("2026-08-14T23:59:59.999Z");
  assert.deepEqual(
    progress.filter((p) => isDueToday(p, endOfDay)).map((p) => p.direction),
    ["reverse", "audio"],
  );
});

test("struggling means ground down, not merely lapsed once", () => {
  assert.equal(isStrugglingProgress({ lapses: 2, repetitions: 5, ease: 2.5 }), true);
  assert.equal(isStrugglingProgress({ lapses: 0, repetitions: 3, ease: 2.1 }), true);
  assert.equal(isStrugglingProgress({ lapses: 1, repetitions: 4, ease: 2.5 }), false);
  // Untouched cards are not struggling, whatever their default ease says.
  assert.equal(isStrugglingProgress({ lapses: 0, repetitions: 0, ease: 2.2 }), false);
});

test("one card is three prompts, and the summary counts both", () => {
  const deck = summarizeDeck([card()], [], NOW);
  assert.equal(deck.due_today.cards, 1);
  assert.equal(deck.due_today.repetitions, 2, "forward is scheduled ahead; the other two are new");
  assert.deepEqual(deck.due_today.by_direction, { forward: 0, reverse: 1, audio: 1 });
  assert.equal(deck.directions_total, 3);
  assert.equal(deck.mature_cards, 1, "a 30-day interval has settled");
});

test("a scheduled direction lands in the forecast rather than in today", () => {
  const deck = summarizeDeck([card({ next_review_at: "2026-08-17T08:00:00.000Z" })], [], NOW);
  assert.equal(deck.due_today.by_direction.forward, 0);
  assert.deepEqual(
    deck.forecast_next_days.filter((d) => d.in_days > 0 && d.repetitions > 0),
    [{ in_days: 3, date: "2026-08-17", weekday: "Monday", repetitions: 1, reviewed: 0 }],
  );
});

test("the forecast starts at today, dated, so a weekday cannot be read as the one just gone", () => {
  const deck = summarizeDeck([card({ next_review_at: "2026-08-17T08:00:00.000Z" })], [], NOW);

  assert.equal(deck.today, "2026-08-14");
  assert.equal(deck.forecast_next_days[0].in_days, 0);
  assert.equal(deck.forecast_next_days[0].date, "2026-08-14");
  assert.equal(deck.forecast_next_days.length, 7);
  // Seven days that all name themselves — the last one is six days out, not seven.
  assert.equal(deck.forecast_next_days.at(-1)?.date, "2026-08-20");
});

test("today's column carries what is left and what has already been done", () => {
  const deck = summarizeDeck(
    [
      card({ id: "left", next_review_at: "2026-08-14T06:00:00.000Z", status: "review", repetitions: 2, last_reviewed_at: "2026-08-10T06:00:00.000Z" }),
      card({ id: "done", next_review_at: "2026-08-25T06:00:00.000Z", status: "review", repetitions: 3, last_reviewed_at: "2026-08-14T08:00:00.000Z" }),
    ],
    [],
    NOW,
  );

  const today = deck.forecast_next_days[0];
  assert.equal(today.repetitions, 5, "one card fully due, one due in its two unscheduled directions");
  assert.equal(today.reviewed, 1, "and one prompt already reviewed today");
  assert.equal(deck.reviewed_today, 1);
});

test("work carried over from an earlier day is reported as carried over", () => {
  const deck = summarizeDeck(
    [
      card({ id: "late", next_review_at: "2026-08-11T06:00:00.000Z", status: "review", repetitions: 2, last_reviewed_at: "2026-08-10T06:00:00.000Z" }),
      card({ id: "today", next_review_at: "2026-08-14T20:00:00.000Z", status: "review", repetitions: 2, last_reviewed_at: "2026-08-13T20:00:00.000Z" }),
    ],
    [],
    NOW,
  );

  // Only the forward direction of "late" has a date behind it; the untouched
  // reverse/audio prompts of both cards are new, which is waiting, not late.
  assert.equal(deck.due_today.overdue_repetitions, 1);
  assert.equal(deck.due_today.overdue_cards, 1);
  assert.equal(deck.due_today.repetitions, 6);
});

test("the variant table carries its own schedule and its own lapses", () => {
  const variants = [
    {
      flashcard_id: "card-1",
      variant: "reverse" as const,
      status: "relearning",
      repetitions: 1,
      lapses: 3,
      easiness_factor: 1.9,
      interval_days: 1,
      next_review_at: "2026-08-20T00:00:00.000Z",
      last_reviewed_at: "2026-08-13T10:00:00.000Z",
    },
  ];
  const deck = summarizeDeck([card()], variants, NOW);
  assert.equal(deck.struggling_cards, 1, "shaky in one direction is shaky");
  assert.equal(deck.due_today.by_direction.reverse, 0, "it has a schedule now, and it is not today");
  assert.equal(deck.due_today.by_direction.audio, 1);
  assert.equal(deck.streak_days, 2, "reviewed today and yesterday");
  assert.equal(deck.reviewed_today, 1);
});

test("an empty deck reports zeroes rather than dividing by nothing", () => {
  const deck = summarizeDeck([], [], NOW);
  assert.equal(deck.due_today.cards, 0);
  assert.equal(deck.directions_percent, 0);
  assert.equal(deck.streak_days, 0);
});

test("prompt arguments are substituted when supplied", () => {
  const prompt = getPrompt("story_from_my_words");
  assert.ok(prompt);
  assert.ok(prompt.build({ topic: "поход к врачу" }).includes("поход к врачу"));
  assert.ok(!prompt.build({}).includes("undefined"));
});
