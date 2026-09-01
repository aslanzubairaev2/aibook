# Handoff: Улучшение AI-объяснений (структурный разбор + грамматический контекст)

- Агент: Gemini Local
- Ветка: `feature/improved-ai-explanations`
- Commit: `dadf45a2437e44ccb8be77cb631bae869aa69852`
- Статус: ready-for-review

## Сделано

1. **Структурный разбор без терминологического барьера (`buildDiscussPrompt.ts`):**
   - Усилены правила `HOW TO WRITE`: запрет сложного грамматического жаргона (Akkusativ, инверсия, наречие и т.д.) без наглядного объяснения сути на понятном человеческом языке через вопросы («кого? что?», «когда/как часто?», «кто делает?»).
   - Если термин всё же называется (Akkusativ, Perfekt), модель обязана дать понятное пояснение в скобках.
   - Для режимов предложений (`sentence`) и фраз (`phrase`) добавлено требование показывать **контрастные пары** (нейтральный порядок слов vs инвертированный) для наглядности V2-позиции глагола.
   - Добавлено требование приводить **антипример (типичную ошибку ✗ vs правильный вариант ✓)**.

2. **Трекинг грамматического контекста (`grammarContext.ts`):**
   - Создан модуль хранения встреченных грамматических паттернов в `localStorage` (языко-агностичный, привязан к `targetLanguage`).
   - Модель возвращает метаданные `grammarPatterns` (id + label на понятном языке).
   - Модальное окно `DiscussAiModal.tsx` автоматически подгружает и передаёт встреченные конструкции в следующие запросы AI.
   - AI теперь знает, какие конструкции пользователь уже встречал, и может кратко отсылать к ним («помнишь, глагол на 2-м месте?»).

3. **Тесты (`buildDiscussPrompt.test.ts`):**
   - Добавлены unit-тесты на парсинг `grammarPatterns`, форматирование грамматического контекста и наличие структурных инструкций для режима `sentence`.

## Изменённые области

- `lib/types.ts` — добавлены типы `GrammarPattern`, `GrammarEncounter`, расширен `DiscussMessage`.
- `lib/ai/grammarContext.ts` — модуль работы с локальным контекстом грамматики (загрузка, сохранение, форматирование в промпт).
- `lib/ai/buildDiscussPrompt.ts` — обновлён системный промпт, расширены инструкции для `phrase`/`sentence`, парсинг `grammarPatterns`.
- `lib/ai/buildDiscussPrompt.test.ts` — unit-тесты на парсинг и внедрение контекста.
- `lib/ai/discuss.ts` — поддержка `grammarContext` в `DiscussRequest`.
- `app/api/ai/discuss/route.ts` — передача `grammarContext` в Gemini API и расширение JSON response schema.
- `components/discuss-ai/DiscussAiModal.tsx` — загрузка `grammarContext` при открытии, передача в запросы, сохранение распознанных паттернов из ответов.

## Проверки

- `node --test lib/ai/buildDiscussPrompt.test.ts lib/ai/discussRoute.test.ts` — passed (23/23 tests pass).
- `npm run build` — passed (Next.js production build succeeds, TypeScript clean).

## Preview

- URL: локальная ветка `feature/improved-ai-explanations`.

## Риски и продолжение

- Изменения обратно совместимы: если `grammarPatterns` отсутствуют в старых кэшированных ответах, они просто пропускаются.
