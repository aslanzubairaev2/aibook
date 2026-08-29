# Handoff: второй движок Live-перевода — gpt-realtime-translate

- Агент: Claude
- Ветка: `claude/live-translate-ui-7795ee`
- Статус: ready-for-review, миграция уже применена к production

## Контекст

Запрос: добавить GPT как альтернативный движок Live-перевода с «жёсткой инструкцией
только переводить, без комментариев и приветствий», выбор движка — в настройках,
плюс расчёт стоимости под цены GPT.

Прежде чем писать промпт, свеча документацию (Context7 + официальный cookbook-гайд
OpenAI на GitHub) — оказалось, что «жёсткая инструкция» не нужна вообще: у OpenAI с
недавнего времени есть **специализированная модель `gpt-realtime-translate`**, прямой
аналог Gemini live-translate-preview. У неё в принципе нет параметра для промпта или
выбора голоса (цитата из официального гайда: *"This model does not currently support
custom prompting or voice selection parameters"*) — она физически не может сказать
что-то кроме перевода, интонацию копирует у говорящего. Это надёжнее промпта на
обычной модели: не «запрещено», а структурно невозможно.

## Что подтверждено вживую (не только по документации)

- `POST https://api.openai.com/v1/realtime/translations/client_secrets` с реальным
  `GPT_API_KEY` → `200 OK`, `session.type: "translation"`, `output.language: "ru"`
  принят, `input.transcription.model: "gpt-realtime-whisper"`,
  `noise_reduction.type: "near_field"` — ровно то, что шлёт роут.
- Тем же эфемерным `client_secret` → `POST /v1/realtime/translations/calls` с
  синтетическим (не от настоящего WebRTC-движка) SDP → `400 "Invalid SDP offer"`, а не
  `401`/`403` — подтверждает, что аутентификация по секрету проходит, отвергнут только
  сам фейковый SDP. Реальный `RTCPeerConnection` в браузере такой SDP не производит.
- В dev-превью: кнопка на экране Live-перевода с выбранным GPT реально дошла до
  `/api/ai/gpt-translate-token`, получила `503` с логом
  `Access Denied: GPT Live Translate is only available to owners.` — то есть весь путь
  кнопка → fetch → серверный роут → auth-гейт работает корректно; отказ ожидаем (гость
  без owner-сессии), тот же паттерн, что и у Gemini-роута.
- Настройки: пикер «Модель Live-перевода» переключается между Gemini Live / GPT Live,
  значение переживает ререндер (сохраняется в профиль/localStorage).
- `npx tsc --noEmit`, `npm run build`, `npm run lint` (по изменённым файлам) — чисто.
- `npm test` — 282/284, те же два предсуществующих флейки в
  `lib/srs/activeTraining.test.ts`, что были до этой ветки.

## Не проверено

Полный голосовой раунд-трип (реальный микрофон + реальный WebRTC SDP-обмен под
owner-сессией) не гонял — для этого нужен настоящий логин владельца, которого у меня
нет и быть не должно. Сервер-сайд часть (минтинг секрета, отклик OpenAI) проверена
напрямую curl-ом с реальным ключом; браузерная часть (RTCPeerConnection, SDP-обмен,
получение audio-трека) проверена только структурно (код + typecheck), не вживую с
голосом.

## Архитектура

`gpt-realtime-translate` работает принципиально иначе, чем Gemini-путь — это не
переиспользование существующего кода, а параллельная реализация:

- **Не WebSocket с ручной перекачкой PCM**, а **WebRTC**: браузер поднимает
  `RTCPeerConnection`, отдаёт микрофон как медиа-трек напрямую (`pc.addTrack`),
  получает переведённый звук как медиа-трек обратно (`pc.ontrack` → `<audio autoplay>`).
  Кодирование/джиттер-буфер/сэмплрейт — целиком на стороне браузерного WebRTC-стека,
  никакого `AudioWorklet` не нужно.
- Транскрипты и события жизненного цикла идут отдельным data-channel'ом (`oai-events`)
  в виде JSON: `session.input_transcript.delta` (исходная речь — то же, что показывает
  панель «Показать текст»), `session.output_transcript.delta` (по нему выведено
  состояние «Перевожу», с затуханием в «Слушаю» через 1.2с простоя — у этой модели нет
  понятия «конец хода», перевод идёт непрерывным потоком).
- Стоимость — не токены, а **плоская ставка $0.034/минуту** аудио. Класс сессии считает
  реальное время соединения и обновляет оценку раз в 5с; `LiveUsageTotals` получил
  необязательное поле `costBasis: "tokens" | "per-minute"`, футер экрана рендерит
  разный текст подсказки и прячет «вход/выход токенов» для GPT.
- Доступ — **только для owner**, без пути «свой ключ» у гостя (в отличие от Gemini,
  где есть `x-gemini-key`). Совпадает с тем, как `GPT_API_KEY` уже используется в
  `app/api/tts/route.ts` — только на сервере, без клиентского оверрайда.
- Целевой язык захардкожен в `ru` на сервере (в роуте минтинга) — так же, как уже
  захардкожен `targetLanguageCode: "ru"` в Gemini-роуте; не стал вводить рассинхрон,
  расширение на `profile.nativeLanguage` не входило в задачу.

## Изменённые/новые файлы

- `lib/ai/gptTranslateModels.ts` — новый: id модели, id модели транскрипции,
  цена/минуту, список 13 поддерживаемых целевых языков (для справки).
- `lib/ai/gptLiveTranslate.ts` — новый: `GptLiveTranslateSession`, WebRTC-класс.
- `app/api/ai/gpt-translate-token/route.ts` — новый: минтинг `client_secret`.
- `lib/ai/serverAuth.ts` — добавлен `getOpenAiApiKeyForRequest` (owner-only).
- `lib/ai/liveTranslateState.ts` — добавлены `LiveTranslateProvider`-хелперы
  (`normalizeLiveTranslateProvider`, `LIVE_TRANSLATE_PROVIDER_LABELS`),
  `calculatePerMinuteUsage`, поле `costBasis` в `LiveUsageTotals`.
- `lib/types.ts` — тип `LiveTranslateProvider`, поле `liveTranslateProvider` в
  `UserProfile`.
- `components/live-translate/LiveTranslateView.tsx` — ветвление по
  `profile.liveTranslateProvider`, отдельные `connectGemini`/`connectGpt`.
- `components/settings/SettingsView.tsx` — новый пикер «Модель Live-перевода».
- `app/page.tsx` — `LiveTranslateView` получает `profile`; чтение
  `live_translate_provider` из Supabase в загрузке профиля.
- `lib/db/supabase.ts` — поле `live_translate_provider` в `DbUserSettings`,
  устойчивый ретрай в `sbUpsertSettings`, если колонки ещё нет (по образцу
  `tts_voices`/`tts_models`).
- `supabase/migrations/20260829130000_live_translate_provider.sql` — новая колонка
  `user_settings.live_translate_provider text default 'gemini'`. **Применена к
  production** (`dkvsixwmrgbdmlpydflw`) через Supabase MCP, подтверждена в
  `information_schema.columns`.

Логика Gemini-пути (`lib/ai/liveTranslate.ts`, VAD-конфиг, wake lock, вёрстка экрана)
не менялась.
