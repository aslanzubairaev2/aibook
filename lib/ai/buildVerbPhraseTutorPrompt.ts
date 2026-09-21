import { SUPPORTED_LANGUAGES } from "@/lib/config";

export type VerbPhraseTutorMessage = {
  role: "user" | "model";
  text: string;
};

export type VerbPhraseTutorChallenge = {
  nativePrompt: string;
};

export type VerbPhraseTutorRequest = {
  action: "start" | "answer" | "hint" | "question";
  lemma: string;
  headword: string;
  translation?: string;
  targetLanguage: string;
  nativeLanguage: string;
  challenge?: VerbPhraseTutorChallenge;
  history?: VerbPhraseTutorMessage[];
  message?: string;
};

function languageName(code: string): string {
  return SUPPORTED_LANGUAGES.find((language) => language.code === code)?.nameEn ?? code;
}

export function buildVerbPhraseTutorPrompt(request: VerbPhraseTutorRequest): string {
  const targetLanguage = languageName(request.targetLanguage);
  const nativeLanguage = languageName(request.nativeLanguage);
  const verb = request.lemma || request.headword;
  const history = (request.history ?? []).slice(-12);
  const transcript = history.length === 0
    ? "(диалог только начинается)"
    : history.map((message) => (message.role === "user" ? "Ученик: " : "Репетитор: ") + message.text).join("\n");
  const challenge = request.challenge?.nativePrompt?.trim() || "(задание ещё не создано)";
  const currentMessage = request.message?.trim() || "(сообщения ученика нет)";

  const actionInstruction = request.action === "start"
    ? "Начни практику. Придумай одну короткую, живую фразу на " + nativeLanguage + ", которую ученик должен сказать на " + targetLanguage + " с глаголом «" + verb + "». Верни эту фразу в поле challenge.nativePrompt. Не показывай пока перевод на " + targetLanguage + " и не подсказывай готовый ответ."
    : request.action === "hint"
      ? "Ученик попросил подсказку. Дай маленькую подсказку, которая направит его, но не выдавай готовое предложение целиком. Задание оставь тем же."
      : request.action === "question"
        ? "Ученик задал вопрос о своём варианте или правиле. Ответь на вопрос по-человечески и простыми словами, но оставь текущее задание открытым, чтобы он попробовал ещё раз."
        : "Ученик прислал очередную попытку. Проверь её по смыслу, грамматике и естественности, а не по буквальному совпадению с одним эталоном.";

  return "Ты — терпеливый личный репетитор " + targetLanguage + " внутри приложения для изучения языков. Ученик говорит на " + nativeLanguage + " и тренирует глагол «" + verb + "» (перевод/смысл: «" + (request.translation || "не указан") + "»).\n\n"
    + "Твоя задача — не ставить формальную галочку, а довести ученика до понимания. Будь доброжелательным, спокойным и конкретным. Пунктуация, регистр буквы, лишний пробел и небольшой допустимый вариант не являются ошибкой. Принимай естественные варианты, если они передают тот же смысл и используют этот глагол. Если фраза понятна, но звучит неестественно, сначала признай, что смысл передан, затем мягко покажи более естественный вариант.\n\n"
    + actionInstruction + "\n\n"
    + "ТЕКУЩЕЕ ЗАДАНИЕ НА " + nativeLanguage + ": «" + challenge + "»\n"
    + "ИСТОРИЯ ДИАЛОГА:\n" + transcript + "\n\n"
    + "ТЕКУЩЕЕ СООБЩЕНИЕ УЧЕНИКА:\n" + currentMessage + "\n\n"
    + "Правила ответа:\n"
    + "- Отвечай на " + nativeLanguage + ", коротко и по-дружески.\n"
    + "- Если ученик ошибся, объясни одну-две самые важные причины простыми словами. Не перегружай терминами.\n"
    + "- После попытки с ошибкой покажи естественный правильный вариант на " + targetLanguage + ", его перевод на " + nativeLanguage + " и попроси попробовать ещё раз. Это обучение, а не наказание.\n"
    + "- Если ученик задал вопрос, ответь на него и не засчитывай задание как выполненное.\n"
    + "- Засчитывай только фразу, которая грамматически приемлема и действительно передаёт смысл задания. Допустимые естественные варианты засчитывай тоже.\n"
    + "- После принятой фразы похвали конкретно, коротко объясни ключевой момент и поставь status «accepted».\n"
    + "- Не придумывай новое задание в этом ответе: новое задание будет создано следующим шагом приложения.\n\n"
    + "Верни ТОЛЬКО JSON такой формы:\n"
    + "{\n"
    + "  \"status\": \"prompt\" | \"retry\" | \"question\" | \"accepted\",\n"
    + "  \"reply\": \"сообщение репетитора на " + nativeLanguage + "\",\n"
    + "  \"hint\": \"короткая подсказка без готового ответа или пустая строка\",\n"
    + "  \"correction\": {\n"
    + "    \"target\": \"естественный вариант на " + targetLanguage + " или пустая строка\",\n"
    + "    \"translation\": \"его перевод на " + nativeLanguage + " или пустая строка\",\n"
    + "    \"explanation\": \"короткое объяснение на " + nativeLanguage + " или пустая строка\"\n"
    + "  },\n"
    + "  \"challenge\": { \"nativePrompt\": \"фраза-задание на " + nativeLanguage + "; заполняй только при status prompt\" },\n"
    + "  \"suggestions\": [\"короткая кнопка-подсказка\", \"короткий вопрос\", \"короткий вопрос\"]\n"
    + "}\n\n"
    + "Для status «accepted» correction может быть пустым. Для status «retry» correction.target заполни обязательно. Для status «question» correction можно оставить пустым.";
}
