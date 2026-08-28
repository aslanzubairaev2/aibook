# Handoff: production-интеграция TTS Storage

- Агент: Codex
- Ветка: `integration/tts-storage-production`
- База: `release/audiobooks-pause` (`25ed19a`)
- Исходные TTS-коммиты: `858d763` и связанное исправление мигратора `88daeeb`
- Commit: pending
- Статус: ready-for-review

## Сделано

- Перенесены только TTS-изменения из `858d763`: server-only cache helper, переключение TTS route на helper, мигратор, SQL-миграция Storage и имя `SUPABASE_SERVICE_ROLE_KEY` в `.env.example`.
- Перенесено только связанное исправление мигратора из `88daeeb`: `--limit` и сохранение `audio_base64`.
- Handoff-файлы исходных коммитов, Live Translate, CEFR и unrelated-файлы не переносились.
- `audio_base64` не удаляется и не очищается ни миграцией, ни мигратором; при ошибке Storage новая запись сохраняется в legacy Base64.

## Проверки

- `npx tsc --noEmit` — passed.
- Релевантный ESLint (`app/api/tts/route.ts`, `lib/db/tts-cache-server.ts`, `scripts/migrate-tts-cache-to-storage.mjs`) — passed, 1 существующий warning в route (`requestedModel`).
- `npm run build` — passed; `/api/tts` собран как dynamic route.
- TTS/WAV/provider tests — passed, 49/49.
- `npm run lint` — failed на 65 существующих ошибках в unrelated-файлах; TTS-файлы ошибок не добавили.
- `npm test` — 242 passed, 2 существующих падения в `lib/cards.test.ts` и `lib/srs/activeTraining.test.ts`.
- Production env names проверены без вывода значений: `NEXT_PUBLIC_SUPABASE_URL` и `SUPABASE_SERVICE_ROLE_KEY` в окружении отсутствуют; `.env.local` отсутствует.
- Текущий Supabase audit (2473 rows/objects, missing, size mismatch, private bucket), live helper read и end-to-end legacy fallback — not run: отсутствуют credentials. Не подменять этот результат данными из исходного handoff.

## Preview

- URL: pending; production deploy не выполнялся.

## Риски и наблюдение

- Перед ручной проверкой Preview задать в Vercel Preview env server-only `SUPABASE_SERVICE_ROLE_KEY` и `NEXT_PUBLIC_SUPABASE_URL`, не выводя их в логах.
- После выдачи credentials повторить aggregate audit: 2473 `storage_path`, 2473 private Storage objects, 0 missing, 0 size mismatch; прочитать несколько объектов через `sbGetCachedTtsServer` и отдельно проверить legacy row fallback.
- Наблюдать 3–5 дней: долю `db_cache`/`api`, Storage download/upload errors, fallback на legacy Base64, 5xx/429 TTS и отсутствие роста новых строк без `storage_path`.
