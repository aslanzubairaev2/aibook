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
    ? "Начни практику без приветствия и лишнего комментария. Придумай одну короткую, живую фразу на " + nativeLanguage + ", которую ученик должен сказать на " + targetLanguage + " с глаголом «" + verb + "». Верни эту фразу только в поле challenge.nativePrompt. Не показывай перевод на " + targetLanguage + " и не подсказывай готовый ответ. Поле reply оставь пустым."
    : request.action === "hint"
      ? "Ученик попросил подсказку. Дай маленькую подсказку, которая направит его, но не выдавай готовое предложение целиком. Задание оставь тем же."
      : request.action === "question"
        ? "Ученик задал вопрос о своём варианте или правиле. Ответь на вопрос по-человечески и простыми словами, но оставь текущее задание открытым, чтобы он попробовал ещё раз."
        : "Ученик прислал очередную попытку. Если это похоже на фразу на " + targetLanguage + ", проверь её по смыслу, грамматике и естественности, а не по буквальному совпадению с одним эталоном. Если вместо фразы на " + targetLanguage + " ученик написал вопрос, комментарий или спор на " + nativeLanguage + " (например, оспаривает предыдущее исправление), не оценивай это как ошибочную попытку: ответь по существу, прямо укажи, если его рассуждение неверно, и оставь задание открытым (status «question»).";

  return "Ты — терпеливый личный репетитор " + targetLanguage + " внутри приложения для изучения языков. Ученик говорит на " + nativeLanguage + " и тренирует глагол «" + verb + "» (перевод/смысл: «" + (request.translation || "не указан") + "»).\n\n"
    + "Проверяй ответ по смыслу, грамматике и естественности, а не по буквальному совпадению с одним эталоном. Пунктуация, регистр буквы, лишний пробел и небольшой допустимый вариант не являются ошибкой. Принимай естественные варианты, если они передают тот же смысл и используют этот глагол. Не веди вежливый разговор: без приветствий, похвалы, подбадривания и фраз вроде «давай разберём», если они не нужны для объяснения.\n\n"
    + actionInstruction + "\n\n"
    + "ТЕКУЩЕЕ ЗАДАНИЕ НА " + nativeLanguage + ": «" + challenge + "»\n"
    + "ИСТОРИЯ ДИАЛОГА:\n" + transcript + "\n\n"
    + "ТЕКУЩЕЕ СООБЩЕНИЕ УЧЕНИКА:\n" + currentMessage + "\n\n"
    + "Правила ответа:\n"
    + "- Отвечай на " + nativeLanguage + " только по делу. Не добавляй приветствия, похвалу, благодарности и повтор задания.\n"
    + "- Если ученик ошибся, заполни correction естественным правильным вариантом на " + targetLanguage + ", его переводом и одной-двумя самыми важными причинами простыми словами. Не дублируй это длинным текстом в reply; reply оставь пустым.\n"
    + "- Если ученик задал вопрос, ответь на него и не засчитывай задание как выполненное.\n"
    + "- Если ученик высказывает неверное грамматическое утверждение (путает род, падеж, спряжение и т.п.), прямо скажи, что это неверно, и объясни, как на самом деле — не ограничивайся намёком.\n"
    + "- Засчитывай только фразу, которая грамматически приемлема и действительно передаёт смысл задания. Допустимые естественные варианты засчитывай тоже.\n"
    + "- После принятой фразы не хвали ученика и не пиши лишний текст: поставь status «accepted», а reply оставь пустым.\n"
    + "- Для suggestions возвращай только короткие действия на " + nativeLanguage + " («Дай подсказку», «Объясни ошибку», «Почему так?»). Никогда не возвращай там готовую фразу на " + targetLanguage + ", её перевод или вариант ответа ученика.\n"
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
