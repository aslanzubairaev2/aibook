# Handoff: тренажёры «Глаголы и предлоги» и «Артикли и падежи»

- Агент: Claude
- Ветка: `claude/aibook-verbs-articles-trainers-b9af3f`
- Commit: см. `git log` ветки
- Статус: ready-for-review

## Сделано

- Два тренажёра в «Практике» на общем движке (`lib/grammar/*`), интерфейс и механика — по образцу
  местоимений. Общий смешанный тренажёр не делался.
- **Глаголы и предлоги**: каталог из 24 единиц «глагол в одном значении + управление» (A1–A2):
  warten auf, denken an, sprechen über / mit, bitten um, aufpassen auf, fragen nach, teilnehmen an,
  danken für; блок возвратных (sich freuen auf / über, sich interessieren für, sich erinnern an,
  sich kümmern um); без предлога: sehen, hören, suchen, brauchen, besuchen, fragen, kennen, anrufen,
  einladen, helfen. У каждой — значение, предлог, падеж, уровень, темы, примеры, контраст.
  Стартовая подборка: warten auf + глаголы без предлога; остальное включается вручную.
- **Артикли и падежи**: 20 рамок-предложений в Nominativ / Akkusativ / Dativ (mit, bei, zu; отдельные
  блоки «глаголы с Dativ» и «geben / schenken»), 45 существительных, определители der / ein / kein и
  все притяжательные, 1–2 пропуска, Dativ мн. ч. с -n, слияния zum / zur / beim. Старт: Nom + Akk, ед. ч.
- Режимы: быстрый выбор, сборка (не все кнопки нужны, всегда два предлога на кнопках), письмо, голос;
  бесконечная практика или подходы 10 / 20 / своё число, без таймера; повторы в подходе — отдельно.
- Проверка правилами: каждое различие названо (не тот / лишний / пропущенный предлог, падеж, род,
  форма определителя, форма существительного, спряжение, порядок слов, возвратное, приставка,
  отрицание); опечатки отдельно; незнакомое слово или сомнительное распознавание → `needs_review`,
  не ошибка. Принимаются все варианты задания (der ↔ ein, sprechen von, suchen nach, zu dem / zum, ae/oe/ue/ss).
- После ошибки: причина, исправление (вторая попытка пишется отдельно), повтор той же конструкции
  через 3 задания с другими словами и в следующих сессиях (`dueKeys`). После верного — озвучка и «Разбор».
- Шпаргалки в обоих тренажёрах (поиск по глаголу/предлогу; таблицы der / ein / kein / mein); открытие
  до ответа помечает ответ как «со шпаргалкой» (`answer_kind: assisted`).
- Тестовый режим разработчика: галочка на экране тренажёра (или `?test=1`) → `meta.test_run`;
  такие события исключены из всех сводок и истории (MCP — только с `include_test_events`).
- MCP 1.13.0: `get_grammar_trainer_config`, `update_grammar_trainer_config` (`learned_add/remove`),
  `create_grammar_trainer_session` (ссылка `/practice/{verb-prepositions|articles}/<id>`);
  `get_training_summary` → блок `grammar_trainers`; `get_training_history` → `grammar_task` и фильтры
  `response_mode`, `answer_kind`, `error_type`, `construction_key`; `submit_pronoun_answer_review`
  принимает и ответы этих тренажёров.

## Изменённые области

- Новое: `lib/grammar/*`, `components/grammar/*`, `app/api/grammar-trainers/*`,
  `app/practice/{verb-prepositions,articles}/[id]`, `lib/mcp/grammarTools.ts`.
- Изменено: `lib/training/{events,store}.ts`, `lib/mcp/{tools,capabilities,trainingTools,pronounTools,version}.ts`,
  `lib/pronouns/store.ts`, `components/practice/PracticeView.tsx`, `app/page.tsx`, `lib/types.ts`,
  `components/ui/AppShell.tsx`, `styles/globals.css`.
- `supabase/migrations/20261022120000_grammar_trainers.sql` — **уже применена** к базе AIBOOK
  (две новые таблицы, существующее не тронуто).

## Проверки

- `npm test` — passed (600, из них 14 новых в `lib/grammar/grammar.test.ts`, включая перебор всех
  заданий: ни одна русская формулировка не допускает двух разных ответов)
- `npx tsc --noEmit` — passed; `next build` — passed
- `npm run lint` — новые файлы чистые; 74 старые ошибки в репозитории не тронуты.
- В приложении (без входа, мобильная ширина): оба тренажёра, сборка, быстрый выбор, письмо,
  исправление, шпаргалка с поиском, бесконечный режим и повтор через 3 задания, подход «1 / 10 +
  повторов», итог при остановке, тестовая пометка.
- Против реальной базы (скриптом, всё созданное удалено): настройки, отказ на несуществующее
  сочетание, сессия со ссылкой и идемпотентным ключом, объяснение пустой выборки, сохранение события,
  фильтр по типу ошибки, исключение тестовых событий из истории и сводки.

## Риски / не проверено

- Голосовой режим не проверен живым голосом (панель браузера не даёт микрофон).
- Путь с входом в аккаунт (сохранение настроек из интерфейса, назначенная сессия по ссылке у
  вошедшего пользователя) не прокликан в браузере — проверен через серверные функции.
