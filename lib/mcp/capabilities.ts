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
      "Where to start. get_overview is the learner's state in one call — languages, deck size, dictionary size, lessons, reading progress. get_capabilities is this map, if you need it again mid-conversation. get_action_history is what this connection has actually changed so far — every add/create/update/delete call, most recent first — useful for checking what you already did before doing it again, or for showing the learner an audit trail.",
    tools: ["get_overview", "get_capabilities", "get_action_history"],
    say: ["«что у меня в приложении?»", "«покажи мой прогресс»", "«что ты уже поменял?»", "«покажи историю изменений»"],
  },
  {
    area: "Flashcards (spaced repetition)",
    summary:
      "The learner's SM-2 deck («Повторение»). Each card is trained in three independent directions — recognition (see the German, recall the meaning), recall (see the meaning, produce the German) and listening (hear it) — each with its own schedule, so a word can be solid in one direction and shaky in another, and a deck of 100 words is 300 prompts. The app has a second trainer beside it («Активно», a written test), but that one keeps its record on the learner's device and is invisible here.",
    tools: ["list_flashcards", "add_flashcards", "update_flashcard", "delete_flashcards", "get_study_words"],
    say: [
      "«добавь это в карточки»",
      "«исправь перевод в карточке»",
      "«удали дубликаты»",
      "«какие слова я уже знаю?»",
    ],
  },
  {
    area: "Dictionary & packs («пачки»)",
    summary:
      "The learner's own dictionary: full entries (article, plural, verb forms, CEFR, example), grouped into packs. A pack is one unit of study — a photographed coursebook page, or a themed set you built with them — with its own progress bar and its own «тренировать» button on the Словарь screen. Words go in with add_word_batch; a set of phrases or whole sentences is a pack too, built with add_flashcards and a 'batch_title'. Everything in a pack is a flashcard from the moment it is added. A pack can also carry its own training setup (update_batch_training): direction, card type, status, trainer — so «тренировать» opens it drilled the way that pack is meant to be drilled, while the learner's own filters stay the default everywhere else. And it carries what it is: update_pack_details writes a description shown under its title and the brief it was built to, which is the only thing that tells one shelf of noun packs from the next months later. delete_pack removes a pack and its entries when it turned out empty, wrong, or the learner asked for it gone — the cards it made stay in the deck unless you delete_flashcards them too.",
    tools: [
      "list_word_batches", "list_batch_words", "search_dictionary",
      "add_word_batch", "add_words_to_batch", "update_batch_training", "update_pack_details", "delete_pack",
    ],
    say: [
      "«сохрани слова по сегодняшней теме»",
      "«что было в пачке про транспорт?»",
      "«найди у меня слово Haltestelle»",
      "«добавь ещё слов в ту пачку»",
      "«эту пачку я хочу переводить с русского и на слух»",
      "«что это была за пачка? для чего я её собирал?»",
      "«удали эту пачку»",
      "«убери пустые пачки»",
    ],
  },
  {
    area: "Learning quality",
    summary:
      "get_progress reads the scheduling record and says which words are confident, which are in progress and which the learner keeps forgetting (lapses, or an ease factor the algorithm has pushed down), broken down by CEFR level and by training direction. It also returns the deck's own numbers — today's workload, the review streak, the week ahead — the same ones the app's statistics panel shows the learner.",
    tools: ["get_progress"],
    say: [
      "«что у меня плохо запоминается?»",
      "«проверь, как идёт учёба»",
      "«сколько мне сегодня повторять?»",
    ],
  },
  {
    area: "Reading texts",
    summary:
      "Texts the learner reads in the app. You write them yourself — you are the language model, this server never spends the learner's AI budget — and create_lesson saves them into «Мои уроки» with an optional glossary and comprehension questions. list_catalogue searches the ready-made public shelves and reports the share of words the learner already knows in each text.",
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
  "The active trainer («Активно» — the written test over вспоминаю / слушаю / говорю) keeps its record on the learner's own device. Nothing about it reaches this connection; what you can read is the «Повторение» deck.",
  "Audio: the app speaks cards and texts itself, through whichever voice engine the learner has chosen in their settings. You cannot make it speak, and no audio comes back through this connection.",
  "The live voice tutor, photo recognition of coursebook pages and in-app AI analysis run inside the app on the learner's own AI budget; this connection is plain data and costs them nothing.",
  "Deleting a text, or a single dictionary entry on its own: still the learner's own action in the app. Packs and flashcards are different — delete_pack and delete_flashcards are both available here, for a pack that turned out wrong or empty and for cleaning up mistakes you made.",
];

/** Practical advice that changes what a good agent does, not decoration. */
export const AGENT_TIPS: string[] = [
  "Write at the learner's level: pull their vocabulary with get_progress or get_study_words first, build the text mostly from confident words, and weave in a few they are forgetting.",
  "Anything you build as a set belongs in a pack, never in loose cards: words go in add_word_batch, phrases and sentences in add_flashcards with a 'batch_title'. The pack is what the learner can see on the Словарь screen, watch progress on, and train with one tap; loose cards are reachable only by hunting through a filter list.",
  "Write down what a pack is the moment you build it: update_pack_details takes a description the learner reads under the title and the brief you were given («винительный падеж, только мужской род, одно прилагательное или без него, единственное число»). A pack whose rules are nowhere written down cannot be extended later — not by them, and not by you. Read the brief back from list_word_batches before adding anything to an existing pack.",
  "Ask how a pack should be drilled, then say so with update_batch_training. «Я хочу переводить эти фразы с русского» is 'variants': ['reverse']; «просто на слух» is ['audio']. Without it the pack trains with the learner's own filters, which is right for an ordinary page of words and wrong for a set built for one purpose.",
  "Counts here are counted the way the app counts them: a card is due if it falls before the end of today, and every card is three prompts, so «сегодня» is both a number of words and a larger number of repetitions. Quote both, or the learner's screen will contradict you.",
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
