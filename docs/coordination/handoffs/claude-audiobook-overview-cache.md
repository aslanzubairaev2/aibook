# Handoff: серверный кеш для AI-обзора аудиокниги

- Агент: Claude
- Ветка: `claude/live-translate-ui-7795ee`
- Статус: ready-for-review, миграция уже применена к production

## Контекст

`AudiobookDetailModal` при каждом открытии модалки вызывал `aiChat(prompt)` заново — карточка
«О чём / Жанр / Язык / Кому» ни разу не кешировалась. Открыл одну и ту же книгу десять раз —
десять платных запросов к Gemini за один и тот же неизменный текст. Владелец хочет кеш в базе,
общий на все устройства, а не локальный (в `lib/db/local.ts` уже есть отдельный, per-device
кеш через `makeAiCacheKey` — это не то, он не переживает переход на другое устройство).

## Сделано

- Новая таблица `ai_audiobook_overview_cache` (миграция
  [20260828100000_ai_audiobook_overview_cache.sql](../../../supabase/migrations/20260828100000_ai_audiobook_overview_cache.sql)):
  публичное чтение и вставка, без `user_id` — обзор не зависит от того, кто спрашивает, поэтому
  кеш общий на всех, как `ai_dictionary_cache` / `ai_tts_cache` / `text_translation_cache`.
  Ключ — `audiobook_id` (стабильный identifier Internet Archive), без хеширования: он короткий
  и совпадает с тем, что уже используется для загрузки самой книги.
- [lib/db/audiobookOverviewCache.ts](../../../lib/db/audiobookOverviewCache.ts) — серверные
  `sbGetCachedAudiobookOverview` / `sbSaveCachedAudiobookOverview` через `supabaseAdmin`,
  по образцу `lib/db/tts-cache-server.ts`.
- [app/api/ai/audiobook-overview/route.ts](../../../app/api/ai/audiobook-overview/route.ts) —
  новый роут. Промпт теперь строится на сервере (раньше собирался в компоненте и летел в
  общий `/api/ai/chat`), это тот же текст, что был. Порядок: сначала читает кеш — **до**
  проверки API-ключа, значит попадание в кеш работает даже для гостя без своего ключа; при
  промахе вызывает Gemini и сохраняет результат (запись — best-effort, ошибка записи не рушит
  ответ).
- [lib/ai/audiobookOverview.ts](../../../lib/ai/audiobookOverview.ts) — клиентский
  `fetchAudiobookOverview(audiobookId, title, author, language)`; переиспользует
  `getAiHeaders` из `lib/ai/chat.ts` (экспортирована, была приватной).
- `AudiobookDetailModal.tsx`: эффект загрузки обзора зовёт `fetchAudiobookOverview` вместо
  `aiChat` с самодельным промптом; убран неиспользуемый импорт `aiChat`.

## Проверка

- `npx tsc --noEmit`, `npm run lint` (по изменённым файлам), `npm run build` — чисто.
- Сквозной прогон в dev-превью: открыл книгу без кеша → `POST /api/ai/audiobook-overview` →
  `403` (гость без ключа, ожидаемо — так было и раньше через `/api/ai/chat`), UI показал
  локальный фолбэк-текст. Вставил тестовую строку в `ai_audiobook_overview_cache` через
  Supabase MCP → переоткрыл ту же книгу → `200 OK`, `{"fromCache": true, "review": "..."}`,
  в UI показался именно кешированный текст, а не заглушка. Тестовую строку удалил после
  проверки.
- Миграция применена к боевому проекту `AIBOOK` (`dkvsixwmrgbdmlpydflw`) через Supabase MCP;
  таблица подтверждена в `list_tables` с RLS и уникальным индексом на `audiobook_id`.

## Не проверено

Реальный вызов Gemini с настоящим ключом не гонял (в среде агента ключа владельца нет,
приходится идти через `x-gemini-key` или owner-сессию, которых здесь нет). Путь записи в кеш
(`sbSaveCachedAudiobookOverview`) не был исполнен вживую — по коду он идентичен уже проверенному
в проде `sbSaveCachedTtsServer`, но первое реальное открытие некешированной книги в production
стоит один раз проверить в логах (`console.error` там, где апсерт может не пройти).
