// Ready-made ways to use aibook, offered through MCP's prompts capability.
//
// Prompts are the part of MCP a client shows to the *learner*, not to the
// model: a slash-command list, a menu of things this connection is good for.
// Tools alone leave them guessing what an app connection is worth; these say
// it in their own language, and each one spells out the tool order that makes
// the result good.

export type McpPromptArg = {
  name: string;
  description: string;
  required?: boolean;
};

export type McpPromptDef = {
  name: string;
  title: string;
  description: string;
  arguments: McpPromptArg[];
  /** Builds the user-turn text the client sends to the model. */
  build: (args: Record<string, string>) => string;
};

const optional = (value: string | undefined, fallback: string) =>
  value && value.trim() ? value.trim() : fallback;

export const MCP_PROMPTS: McpPromptDef[] = [
  {
    name: "story_from_my_words",
    title: "Рассказ из моих слов",
    description: "Write a short story built from the words this learner actually knows, and save it into their lessons.",
    arguments: [
      { name: "topic", description: "What the story should be about" },
      { name: "level", description: "CEFR level, if you want to force one" },
    ],
    build: (a) => `Call get_progress to see which words I know confidently and which I keep forgetting. Then write me a short story about ${optional(a.topic, "anything you think fits what I am learning")}${a.level ? ` at level ${a.level}` : " at roughly my level"}: build it mostly from the confident words, work in the ones I keep forgetting, and add no more than a handful of genuinely new ones. Save it with create_lesson, including a small glossary for the new words and three comprehension questions. Then tell me in Russian what you wrote and which words you chose to drill.`,
  },
  {
    name: "save_todays_words",
    title: "Сохранить слова из разговора",
    description: "Turn the vocabulary from this conversation into a batch in the learner's dictionary.",
    arguments: [{ name: "topic", description: "The theme these words belong to" }],
    build: (a) => `Take the words we have used in this conversation${a.topic ? ` about ${a.topic}` : ""} and save them with add_word_batch as one themed batch. Fill in each word properly: the headword as a dictionary prints it (nouns with their article), the base form, the translation, part of speech, plural or irregular verb forms, CEFR level, and one short example sentence with its translation. Give the batch a title I will recognise in my Словарь. Afterwards, tell me which words you saved and which ones I already had.`,
  },
  {
    name: "what_am_i_forgetting",
    title: "Что я забываю",
    description: "Find the words the spaced repetition says are slipping, and drill them.",
    arguments: [],
    build: () => `Call get_progress and look at the words I keep forgetting — the lapses and the low ease factors. Tell me in Russian what the pattern is (a grammar trap? a group of similar words? words I never see in context?), then practise them with me: use each one in a sentence built from words I already know confidently, and ask me to produce them back. Do not just list the words.`,
  },
  {
    name: "train_a_batch",
    title: "Разобрать пачку слов",
    description: "Work through one page of coursebook vocabulary with the learner.",
    arguments: [{ name: "batch", description: "Which batch — a title, a topic, or an id" }],
    build: (a) => `Call list_word_batches, find ${optional(a.batch, "the batch I am currently working on")}, and read it with list_batch_words. Check with list_flashcards (filter 'struggling') which of those words are not sticking. Then teach me that page: group the words so they make sense together, point out the traps (cases, genders, separable verbs, false friends), and give me a few sentences to translate. If we produce new words along the way, add them to that same batch with add_words_to_batch.`,
  },
  {
    name: "what_should_i_read",
    title: "Что мне почитать",
    description: "Pick a text from the catalogue that fits what the learner already knows.",
    arguments: [],
    build: () => `Call list_catalogue and pick two or three texts I could read now — ones where I already know most of the words. Tell me in Russian why each one fits and what new vocabulary it would teach me. If nothing in the catalogue fits, say so and offer to write me a text instead with create_lesson.`,
  },
];

export function getPrompt(name: string): McpPromptDef | undefined {
  return MCP_PROMPTS.find((p) => p.name === name);
}
