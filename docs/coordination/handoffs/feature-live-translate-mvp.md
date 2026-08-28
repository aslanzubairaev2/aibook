# Handoff: Live перевод MVP

- Агент: Codex
- Ветка: `feature/live-translate-mvp`
- База: `release/audiobooks-pause`
- Commit SHA: `6b02638` (`feat: add live translation MVP`)
- Статус: ready-for-review

## Сделано

- На главной добавлена заметная отдельная кнопка «Live перевод».
- Добавлен изолированный экран `LiveTranslateView` с одной основной кнопкой, понятными статусами, кнопкой показа исходной иностранной транскрипции и рекомендацией наушников.
- Добавлен `LiveTranslateSession`: микрофон → PCM 16 kHz → Gemini Live → PCM 24 kHz в браузер; остановка закрывает сессию, AudioContext и все MediaStream tracks.
- Добавлен server route `/api/ai/live-translate-token`, который не отдаёт ключ клиенту, а выпускает одноразовый ephemeral token на 30 минут с ограничениями на модель и русский target language.
- Не изменялись TTS Storage, аудиокниги, CEFR, аудиоплеер и `DiscussAiModal`.
- Добавлен unit-тест state/форматирования транскрипции `lib/ai/liveTranslateState.test.ts`.
- Добавлен накопительный мониторинг `usageMetadata` текущей сессии: вход/выход/total и USD-оценка; детализация помечается недоступной при отсутствии modality details.

## Изменённые файлы

- `app/api/ai/live-translate-token/route.ts`
- `app/page.tsx`
- `components/home/HomeDashboard.tsx`
- `components/live-translate/LiveTranslateView.tsx`
- `lib/ai/liveModels.ts`
- `lib/ai/liveTranslate.ts`
- `lib/ai/liveTranslateState.ts`
- `lib/ai/liveTranslateState.test.ts`
- `lib/ai/liveTranslateState.usage.test.ts`
- `lib/types.ts`
- `package.json`
- `styles/globals.css`

## Авторизация и API

Используется `getApiKeyForRequest`: server route принимает серверный ключ для allowlisted owner либо пользовательский ключ из Settings через `x-gemini-key`, но в браузер возвращает только ephemeral token. Клиент подключается через `@google/genai` к `gemini-3.5-live-translate-preview` с `responseModalities: AUDIO`, input/output transcription и `translationConfig.targetLanguageCode: ru`.

Официальные источники: [Live translation](https://ai.google.dev/gemini-api/docs/live-api/live-translate), [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens).

## Мониторинг расхода

Standard rates сверены 28.08.2026 по [официальной pricing documentation](https://ai.google.dev/gemini-api/docs/pricing): input audio `$3.50 / 1M`, output audio `$21.00 / 1M`. Счётчик использует только `usageMetadata` серверных сообщений, обнуляется при новом старте и не сохраняется. UI явно показывает «оценка»; включённая input/output transcription может добавлять текстовые токены сверх аудио-стоимости и это отражено предупреждением/tooltip.

## Проверки

- `node --experimental-strip-types --test lib/ai/liveTranslateState.test.ts lib/ai/liveTranslateState.usage.test.ts` — passed, 5/5.
- `git diff --check` — passed.
- `npx tsc --noEmit` — passed.
- Targeted eslint для новых файлов — passed.
- `npm run lint` — failed на 66 предсуществующих ошибках в других файлах; новых ошибок Live Translate нет.
- `npm run build` — passed; маршрут `/api/ai/live-translate-token` присутствует в build.
- `npm test` — 244 passed, 2 предсуществующих падения (`lib/cards.test.ts`, `lib/srs/activeTraining.test.ts`); новые Live Translate tests passed.

## Preview и ручной сценарий

- Preview URL: https://aibook-hqzwcxz81-azamats-projects-799bf3a6.vercel.app (Vercel `READY`, deployment `dpl_JBk6sxdsYySQjeD2APmzLQXA9dq5`, собран из `6b02638`).
- Модель: `gemini-3.5-live-translate-preview` (единая константа `LIVE_TRANSLATE_MODEL` используется route, клиентской сессией и UI).
- Реальное соединение Gemini Live и микрофон в Preview не проверены: в окружении отсутствуют `GEMINI_API_KEY`, Supabase auth/owner env и пользовательский Gemini key. `/api/ai/live-translate-token` локально проверен на честный отказ 503 без credentials.
- После установки зависимостей и настройки `GEMINI_API_KEY` или пользовательского Gemini key: открыть главную → «Live перевод» → «Начать перевод» → разрешить микрофон → говорить на иностранном языке → проверить русский аудиовыход, «Показать текст», остановку и повторный старт. Отдельно проверить отказ микрофона и отсутствие сети.

## Ограничения и риски

- Для production нужен HTTPS/localhost и доступные `getUserMedia`/`AudioContext`.
- Автоматическое переподключение не выполняется без действия пользователя: при сетевой ошибке сессия очищается, большая кнопка позволяет безопасно запустить новый ephemeral token и повторить подключение.
- SDK/модель preview могут быть недоступны для конкретного Gemini project или региона; route честно возвращает ошибку, UI показывает `Ошибка соединения`.
