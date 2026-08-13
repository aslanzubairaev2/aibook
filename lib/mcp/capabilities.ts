// What a connected agent can do with aibook, written down once.
//
// An outside agent only ever learns about this app from three places: the
// `instructions` returned by initialize, the tool list, and whatever a tool
// itself says back. Clients differ in which of those they actually show the
// model — ChatGPT's connector UI drops `instructions`, some CLIs never fetch
// resources — so the same map of the app is served through all of them, built
// from this one description instead of being retyped per surface.
//
// English prose, Russian trigger phrases: the model reads the former, the
// learner speaks the latter.

export type CapabilityArea = {
  /** Short name of the area, as the learner would think of it. */
  area: string;
  /** What this part of the app is, in one or two sentences. */
  summary: string;
  /** Tools that belong to it, in the order an agent would use them. */
  tools: string[];
  /** Things the learner actually says that should lead here. */
  say: string[];
};

export const CAPABILITY_AREAS: CapabilityArea[] = [
  {
    area: "Overview & discovery",
    summary:
      "Where to start. get_overview is the learner's state in one call — languages, deck size, dictionary size, lessons, reading progress. get_capabilities is this map, if you need it again mid-conversation.",
    tools: ["get_overview", "get_capabilities"],
    say: ["«что у меня в приложении?»", "«покажи мой прогресс»"],
  },
  {
    area: "Flashcards (spaced repetition)",
    summary:
      "The learner's SM-2 deck. Each card is trained in three independent directions — recognition (see the German, recall the meaning), recall (see the meaning, produce the German) and listening (hear it) — each with its own schedule, so a word can be solid in one direction and shaky in another.",
    tools: ["list_flashcards", "add_flashcards", "update_flashcard", "delete_flashcards", "get_study_words"],
    say: [
      "«добавь это в карточки»",
      "«исправь перевод в карточке»",
      "«удали дубликаты»",
      "«какие слова я уже знаю?»",
    ],
  },
  {
    area: "Dictionary & word batches («пачки»)",
    summary:
      "The learner's own dictionary: full entries (article, plural, verb forms, CEFR, example), grouped into batches. A batch is one page of vocabulary — usually photographed from a coursebook — kept together as the unit they were set to learn, with its own progress bar and its own «тренировать» button. Every word of a batch is a flashcard from the moment it is added.",
    tools: ["list_word_batches", "list_batch_words", "search_dictionary", "add_word_batch", "add_words_to_batch"],
    say: [
      "«сохрани слова по сегодняшней теме»",
      "«что было в пачке про транспорт?»",
      "«найди у меня слово Haltestelle»",
      "«добавь ещё слов в ту пачку»",
    ],
  },
  {
    area: "Learning quality",
    summary:
      "get_progress reads the scheduling record and says which words are confident, which are in progress and which the learner keeps forgetting (lapses, or an ease factor the algorithm has pushed down), broken down by CEFR level and by training direction.",
    tools: ["get_progress"],
    say: ["«что у меня плохо запоминается?»", "«проверь, как идёт учёба»"],
  },
  {
    area: "Reading texts",
    summary:
      "Texts the learner reads in the app. You write them yourself — you are the language model, this server never spends the learner's AI budget — and create_lesson saves them into «Мои уроки» with an optional glossary and comprehension questions. list_catalogue shows the ready-made public texts with the share of words the learner already knows.",
    tools: ["create_lesson", "list_texts", "get_text", "list_catalogue"],
    say: [
      "«напиши рассказ из моих слов»",
      "«что мне почитать?»",
      "«давай обсудим тот текст»",
      "«сделай урок по теме “врач”»",
    ],
  },
];

/**
 * What the connected agent cannot do, said plainly so it stops guessing.
 * Everything here is a real part of the app that simply has no MCP surface.
 */
export const AGENT_LIMITS: string[] = [
  "Grading reviews: only the learner can answer a card. You add and edit cards; the app schedules them.",
  "Audio: narration and text-to-speech happen in the app, not through this connection.",
  "The live voice tutor, photo recognition of pages and in-app AI analysis run inside the app on the learner's own AI budget; this connection is plain data and costs them nothing.",
  "Deleting texts, batches or the dictionary: removal is the learner's own action in the app (delete_flashcards is the one exception, for cleaning up mistakes you made).",
];

/** Practical advice that changes what a good agent does, not decoration. */
export const AGENT_TIPS: string[] = [
  "Write at the learner's level: pull their vocabulary with get_progress or get_study_words first, build the text mostly from confident words, and weave in a few they are forgetting.",
  "A themed set of words belongs in add_word_batch, not in add_flashcards — the batch is what the app can train, show progress for and re-open as a page.",
  "Practise a new grammar point with words the learner already knows, so the sentence tests the construction and not the vocabulary.",
  "Everything you write lands in the learner's own app, under «Мои уроки» or «Словарь». It shows up after they refresh.",
  "Nothing here spends the learner's AI budget; these tools are plain database reads and writes.",
];

/** The short version, for `initialize`'s instructions field. */
export function buildInstructions(): string {
  const areas = CAPABILITY_AREAS.map(
    (a) => `- ${a.area}: ${a.summary}\n  Tools: ${a.tools.join(", ")}\n  Sounds like: ${a.say.join(", ")}`,
  ).join("\n");

  return `aibook is a language-learning app — a reader, a dictionary and a spaced-repetition deck. This connection belongs to one learner; get_overview tells you which languages they are learning.

You are the teacher on the other end of it: you write the texts and choose the words, and these tools put them into the learner's app.

${areas}

Worth knowing:
${AGENT_TIPS.map((t) => `- ${t}`).join("\n")}

Not available through this connection:
${AGENT_LIMITS.map((l) => `- ${l}`).join("\n")}

If you have lost track of what is here, call get_capabilities.`;
}
