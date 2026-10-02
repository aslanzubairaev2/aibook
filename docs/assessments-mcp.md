# Интерактивные тесты через MCP — руководство для преподавательского агента

Преподаватель (любой MCP-клиент: Claude, ChatGPT, Gemini CLI…) создаёт тест через MCP-подключение
AIBook, приложение само озвучивает аудирование своим Gemini TTS, ученик проходит тест в приложении по
ссылке, а агент получает ответы, проверяет письмо и собирает пачку слов для повторения.

Подключение: **Настройки → Подключение ИИ-агентов** → личный URL `/api/mcp/<token>`. Всё, что ниже,
— инструменты этого сервера. Полное машинное описание всегда доступно вызовом
`get_assessment_capabilities` (там же готовый пример теста).

## Порядок работы

```
get_assessment_capabilities            ← один раз: типы заданий, голоса, правила
create_assessment(client_key, …)       ← черновик; повтор с тем же client_key не создаёт дубль
prepare_assessment_audio(id)           ← повторять, пока все аудио не «ready»
publish_assessment(id)                 → ссылка https://…/test/<id>  (тест появится и на главной)
   … ученик проходит тест …
get_assessment_results(assessment_id)  ← сырые ответы, история изменений, прослушивания
submit_assessment_review(attempt_id, items[], summary, gaps[])
get_learning_gaps(attempt_id)          ← ошибки + ваши пробелы
check_dictionary_words(words[])        ← убрать уже известные слова
add_word_batch(title, words[], …)      ← пачка только из новых слов и устойчивых выражений
```

## Режимы

| | `learning` (обучение) | `diagnostic` (диагностика, по умолчанию) |
|---|---|---|
| Подсказки (`hint`) | показываются | не хранятся вовсе |
| Перевод текста (`translation`) | показывается | не отдаётся |
| Обратная связь | `immediate`: сразу после «Ответить»; правильный ответ — после верного ответа, «Не знаю» или `max_tries` ошибок (по умолчанию 3) | только в момент `results_release` |
| Повторные попытки | да | ответ можно менять до «Завершить блок»; хранятся первый ответ и вся история |
| Порядок блоков | `free` | `sequential` |
| Лимит прослушиваний | без лимита, если не задан | по умолчанию 2 |

`results_release`: `immediate` (только обучение) · `after_section` · `after_submit` · `after_review`
(всё скрыто до вашего `submit_assessment_review`; если ручной проверки нет — до сдачи).

«Не знаю» — отдельный статус `dont_know`, не пропуск.

## Структура теста

```jsonc
{
  "client_key": "de-a2-2026-10-02",       // ключ идемпотентности
  "title": "Проверка A2",
  "description": "…",
  "mode": "diagnostic",
  "language": "de",                       // по умолчанию — изучаемый язык ученика
  "settings": { "results_release": "after_review", "section_order": "sequential", "max_tries": 3, "allow_retake": false },
  "sections": [ /* блоки: один блок = один экран */ ]
}
```

**Блок (section)**: `id`, `title`, `instructions` (на родном языке), `skill`
(`reading | listening | writing | grammar | vocabulary`; по умолчанию из стимула), `stimulus`, `items`.
Держите блок небольшим: текст + его вопросы, одна запись + её вопросы или 3–8 грамматических заданий.

**Стимул «текст»** — показывается рядом с вопросами (на телефоне — над ними):
```json
{ "type": "text", "title": "Am Bahnhof", "paragraphs": ["…"], "translation": ["…только для learning…"] }
```

**Стимул «аудио»** — агент передаёт только текст, приложение озвучивает само:
```jsonc
{
  "type": "audio",
  "max_plays": 2,                          // 1–10
  "unlock_questions": "immediately",       // или "after_first_play"
  "show_transcript": "after_results",      // never | after_section | after_results
  "audio": { "kind": "monologue", "text": "Achtung am Gleis sieben…", "voice": "Charon", "pace": "slow" }
}
```
Диалог:
```json
"audio": {
  "kind": "dialogue", "pace": "normal", "style": "two friends at a café",
  "speakers": [{ "name": "Anna", "voice": "Kore" }, { "name": "Ben", "voice": "Puck" }],
  "lines": [
    { "speaker": "Anna", "text": "Hallo Ben! Wie war dein Wochenende?" },
    { "speaker": "Ben", "text": "Super! Ich war mit meinem Bruder am See." }
  ]
}
```
Голоса: женские — Kore, Aoede, Leda, Zephyr, Callirrhoe, Autonoe, Despina, Erinome, Laomedeia, Achernar,
Gacrux, Pulcherrima, Vindemiatrix, Sulafat; мужские — Puck, Charon, Fenrir, Orus, Enceladus, Iapetus,
Umbriel, Algieba, Algenib, Rasalgethi, Alnilam, Schedar, Achird, Zubenelgenubi, Sadachbia, Sadaltager.
До 4 говорящих, 40 реплик, 4000 символов. Имена говорящих не зачитываются.

### Типы заданий

Общие поля: `id`, `type`, `prompt`, `points` (по умолчанию 1; пропуски 2; письмо 10), `skill?`,
`focus?` (`meaning | grammar | vocabulary | spelling | instruction` — ошибкой чего считается неверный ответ),
`hint?`, `explanation?` (видна после раскрытия), `criteria?` (ваша рубрика, ученику не видна).

| type | поля | проверка |
|---|---|---|
| `single_choice` | `options: string[] \| {id,text}[]`, `correct`: id или точный текст | авто |
| `multiple_choice` | `options`, `correct: [...]` | авто, частичный балл (верные − лишние) / верные |
| `gap_select` | `text` с `{{1}}`, `gaps: [{id, options[], answer}]` | авто, выпадающий список |
| `gap_text` | `text` с `{{1}}`, `gaps: [{id, answer, accepted?[]}]`, `typo_tolerance?` | авто, с допуском опечаток |
| `word_order` | `words[]` в правильном порядке (ученику — перемешанные), `accepted?[]` | авто |
| `short_answer` | `accepted?[]` | авто при совпадении, иначе — на вашу проверку (не «неверно»!) |
| `writing` | `criteria` (обязательно), `min_words?`, `max_words?` | только вы |

**Опечатки.** Ответ, отличающийся регистром, написанием умлаутов (ae/oe/ue/ss) или одной буквой (двумя в
длинных словах), получает половину баллов, отмечается как `meaning: ok, spelling: error` и попадает в
`awaiting_your_review` — подтвердите или переоцените. Если `focus: "grammar"`, допуск по буквам
отключается (там одна буква — это окончание).

## Аудио: генерация, кэш, повтор

* `prepare_assessment_audio` генерирует всё в статусе `pending`/`error` примерно за 25 секунд и
  возвращает статус каждого блока: `pending` / `ready` / `error` (с текстом ошибки). Вызывайте, пока
  `all_ready` не станет `true`.
* Повтор безопасен: готовые записи не перегенерируются; одна и та же запись (тот же текст, голоса, темп,
  модель) переиспользуется даже из другого теста; параллельные вызовы не оплачивают одно и то же дважды
  (атомарный «захват» строки с таймаутом 2 минуты).
* `force: true` — перегенерировать даже готовое (тратит квоту).
* Модель: `ASSESSMENT_TTS_MODEL` (env), по умолчанию `gemini-3.8-flash-tts` — тот же ID, которым
  приложение уже говорит; проверен живым запросом 2026-10-02. Диалог из ≤2 голосов записывается одним
  запросом (голос каждой реплики задаётся в `speech_metadata.speaker`); 3–4 голоса или сбой — по репликам
  со склейкой (пауза 450 мс). При исчерпании квоты — каскад `gemini-3.1-flash-tts-preview` →
  `gemini-2.5-flash-preview-tts` → `gemini-2.5-pro-preview-tts`.
* Квота: ~100 записей в день на модель на всё приложение. Озвучивайте только нужное.

### Правила прослушивания (диагностика)

* Счётчик хранится на сервере (`assessment_start_listen`, атомарно): перезагрузка, вторая вкладка или
  другое устройство его не сбрасывают.
* Прослушивание засчитывается в момент реального начала звука. Ошибка загрузки или воспроизведения до
  звука попытку не тратит.
* Пауза и продолжение — то же прослушивание. Перемотки нет. Запись закончилась — следующий старт
  считается новым прослушиванием.
* После исчерпания лимита плеер блокируется, ссылка на файл больше не выдаётся, текст записи скрыт до
  `show_transcript`.
* Это контроль внутри приложения, а не защита от записи звука.

## Результаты

`get_assessment_results({ assessment_id })` или `({ attempt_id })` возвращает:

* `totals`, `skills` (чтение / аудирование / письмо / грамматика / словарь; непроверенное не считается
  нулём), `dimensions` (смысл / грамматика / словарь / орфография / выполнение инструкции);
* по каждому заданию: `answer_raw` (дословно), `answer` (читаемо), `answer_status`
  (`answered | dont_know | unanswered`), `first_answer`, `history`, `changes`, `tries`, `unsent_draft`
  (то, что ученик напечатал, но не отправил), `word_count`, `expected`, `criteria`, `result`;
* по блокам: `completed`, прослушивания `used/max_plays` с временем каждого, транскрипт, текст чтения;
* `unfinished_items`, `awaiting_your_review`, `learner_sees_results`.

### Проверка

```json
{
  "attempt_id": "…",
  "items": [
    { "item_id": "w1", "score": 8, "comment": "Перфект верный, не хватает вопроса к Анне.",
      "dimensions": { "meaning": "ok", "grammar": "ok", "vocabulary": "minor", "spelling": "ok", "instruction": "minor" },
      "corrected": "Hallo Anna! …" },
    { "item_id": "m1", "score": 1, "comment": "Опечатка: fünfzehn.", "dimensions": { "spelling": "minor" } }
  ],
  "summary": "Чтение уверенно, в аудировании внимательнее к деталям.",
  "gaps": [{ "topic": "Притяжательные в дательном", "skill": "grammar", "description": "mit meinem/meiner", "words": ["der Bruder"] }]
}
```
Вызовы складываются (второй дополняет первый). Когда оценены все письменные/свободные ответы, попытка
становится `reviewed` и ученик видит результаты (`final: false` — придержать).

## Пачка для повторения

1. `get_learning_gaps` — ошибки, «не знаю», частичные ответы и ваши `gaps`.
2. Выберите материал сами: ошибка в ответе не значит, что все слова в нём незнакомы.
3. `check_dictionary_words({ words: ["der Bahnhof", "die Verspätung"] })` → `new_words`, `already_known`
   (артикли и регистр игнорируются).
4. `add_word_batch` только с `new_words`. Правила ученика:
   * в словарь и карточки — **только отдельные слова и устойчивые выражения**
     (`content_type: "word" | "expression"`); учебные предложения остаются в тестах;
   * имена людей и названия организаций автоматически не добавлять;
   * заполняйте артикль, мн. число, формы глагола, перевод, пример, `description` и `instruction` пачки,
     при необходимости `training`.

## Хранение и безопасность

* Таблицы `assessments`, `assessment_audio`, `assessment_attempts` — RLS без политик: доступ только
  серверными маршрутами (service role). Правильные ответы и транскрипты никогда не попадают в браузер до
  разрешённого момента — это решает одна функция `lib/assessments/publicView.ts` (покрыта тестами).
* Попытка замораживает версию теста (`snapshot`): `update_assessment` после начала не меняет то, что
  ученик проходит и по чему его оценивают.
* Аудио — приватный бакет `tts-audio/assessments/<sha256>.wav`, ученику выдаётся подписанная ссылка на
  5 минут и только пока остались прослушивания.

## Где код

| Что | Файл |
|---|---|
| Модель и валидация входа | `lib/assessments/model.ts` |
| Проверка, опечатки, сводки | `lib/assessments/grading.ts` |
| Что видит браузер | `lib/assessments/publicView.ts` |
| Озвучка | `lib/assessments/speech.ts` |
| БД-операции | `lib/assessments/store.ts` |
| MCP-инструменты | `lib/mcp/assessmentTools.ts` |
| API ученика | `app/api/assessments/route.ts`, `app/api/assessments/[id]/route.ts` |
| Экран теста | `app/test/[id]/page.tsx`, `components/assessment/*` |
| Миграция | `supabase/migrations/20261002120000_assessments.sql` |
