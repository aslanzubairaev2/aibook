# Handoff: постоянный кэш и ожидание субтитров

- Агент: Codex
- Ветка: `fix/native-transcript-wait`
- Commit: `9d4efcc` (код и тесты)
- Статус: ready-for-review

## Причина

Реальный диагностический запрос Supadata mode=native получил HTTP 429:
`Plan usage limit was exceeded.` Это утверждение провайдера, не аудит списаний.
В production 00640ac полного постоянного кэша YouTube-реплик не было.
Запасной HTML-поиск вызывал fetchYouTubeTranscript для всех найденных кандидатов.
В video_library сохранялась позиция и последняя реплика, но не полный текст.
По текущим тарифам Supadata Free — 100 кредитов в месяц, native — 1 кредит,
генерация — 2 кредита/минуту: https://supadata.ai/pricing.
Точные прошлые списания не установлены.

## Сделано

- Supadata только mode=native, без AI-генерации.
- Сервер возвращает pending/202 с неизменным jobId. Браузер опрашивает то же
  задание без общего ограничения попыток/времени; закрытие останавливает ожидание.
- Временные ошибки опроса повторяются с задержкой; квота, отказ и истёкшее
  задание показываются явно. Потеря первого ответа без jobId не запускает
  бесконечные новые платные запросы.
- Общая таблица youtube_transcripts (video_id, language, cues), без TTL:
  проверяется до Supadata, успешные реплики записываются до ответа клиенту.
  Ошибка чтения кэша не трактуется как промах; пустые ответы не записываются.
- В браузере localStorage-кэш полных проверенных cues, sessionStorage jobId.
- Одновременные запросы одного server process объединяются.
- Поиск читает только готовый кэш: никаких фоновых Supadata-запросов.
- Transcript endpoint исключён из NetworkFirst service-worker-кэша, чтобы старый
  пустой ответ не подменял текущее ожидание.
- Дизайн/управление репликами Claude и styles/videos.css не изменены.

## Изменённые области

- lib/videos/youtubeTranscript.ts, loadTranscript.ts, transcriptCacheServer.ts,
  subtitleCues.ts, youtubeSearch.ts — получение и хранение.
- app/api/videos/transcript/route.ts, components/videos/VideoPlayerModal.tsx —
  статусы ожидания/ошибки и повтор.
- next.config.ts — NetworkOnly для transcript API.
- lib/videos/transcript.test.ts, videos.test.ts, package.json — тесты без платных API.
- supabase/migrations/20260831170808_youtube_transcript_cache.sql — новый кэш.

## База

Миграция применена только к проекту AIBOOK dkvsixwmrgbdmlpydflw.
RLS включён, anon/authenticated лишены доступа, запись/чтение — service_role.
Проверены SQL insert/select с rollback и чтение серверным ключом приложения.
Тестовые данные не оставлены. Advisors: INFO RLS без policy ожидаем для server-only
таблицы; существующий WARN leaked password protection не относится к этой задаче.
Ссылки:
https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy
https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection

## Проверки

- npm run build — passed (после удаления временных dev-типов тестовой страницы).
- npm run test:videos — 19/19.
- npm test — 341/343; прежние падения cards statistics и activeTraining future day.
- npm run lint — 85 errors / 39 warnings, как до изменений.
- Точечный lint новых модулей, route, search, next.config — passed.
- Браузер 390x844 и 1440x1000: pending, quota, unavailable, готовые cues.
  После reload число transcript-запросов не увеличилось; horizontal overflow нет.
  YouTube, Supadata и перевод в этих UI-тестах подменены, кредиты не расходовали.
- Временная QA-страница удалена. Сгенерированные SW-файлы и чужие изменения не коммитятся.

## Preview

- URL: не создан на момент handoff.
- Production-код не опубликован, main не изменён.
- Предыдущий push был заблокирован auto-review; обход не предпринимался.
- 31.08.2026 владелец явно разрешил слияние этой ветки в main и production-релиз.
  Повторные профильные тесты 19/19; origin/main перед слиянием — 00640ac.

## Риски и продолжение

- Старые полные тексты не были сохранены и не восстанавливаются из video_library.
- Квота Supadata остаётся ограничением для ещё не закэшированных видео.
- Нужны NEXT_PUBLIC_SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY на сервере окружения.
- Дедупликация первого запроса пока в пределах процесса: два одновременных
  холодных serverless instance могут запросить одно новое видео до записи кэша.
- При ошибке записи БД полученные cues всё равно возвращаются и сохраняются
  браузером; ошибка логируется. Заполнение localStorage не ломает серверный кэш.
- Без native-субтитров видео получит явное unavailable; генерации нет.
- Политики кэша не меняют тариф и не включают автопополнение Supadata.
