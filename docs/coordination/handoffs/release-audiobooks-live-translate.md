# Handoff: production release аудиокниг, Live Translate и TTS Storage

- Агент: Codex
- Ветка: `main`
- Release-ветка: `release/audiobooks-pause`
- Main release commit: `a42bcabd6e479dfd253b43439bcdcfa1191f45ef`
- Production deployment: https://aibook-liart.vercel.app
- Deployment URL: https://aibook-583h9c81o-azamats-projects-799bf3a6.vercel.app
- Final deployment ID: `dpl_2Avxrpo1b8cAjdEdWLTM4qirXMQ3`
- Статус deployment: `READY`

## Вошло в release

- Audiobooks home quality из актуального `feature/audiobooks-home-quality` (`dc37d13`, включая `0607d24`):
  честная CEFR-классификация, рекомендации на главной, Media Session, устойчивое воспроизведение и восстановление
  позиции при возобновлении.
- Live Translate MVP из `feature/live-translate-mvp` (`6b02638`, `b898098`): отдельный экран,
  ephemeral-token route и поток Gemini Live.
- TTS Storage из актуального `integration/tts-storage-production` (`638f5c8`): server-only cache helper,
  Storage migration, мигратор и чтение legacy cache keys (`3d93967`). Перенос выполнен выборочно поверх актуального
  release, без удаления Audiobooks/Live Translate.
- `audio_base64` сохранён в legacy schema, fallback и миграторе; cleanup не выполнялся.

## Проверки

- Целевые Audiobooks/Media Session/Live Translate тесты: `42/42 passed`.
- TTS/provider/WAV тесты прошли в доступном объёме; TTS cache test локально заблокирован отсутствующим
  `@supabase/supabase-js`.
- Полный `npm test`: `245 passed`; локально не завершились тесты, требующие отсутствующих
  `ws`, `@google/genai`, `@supabase/supabase-js`, а также два известных timezone-зависимых падения
  в `lib/cards.test.ts` и `lib/srs/activeTraining.test.ts`.
- Локальные `tsc`, `npm run lint`, `npm run build`: заблокированы отсутствующими локальными зависимостями
  и `EACCES` при попытке npm обратиться к registry.
- Удалённый Vercel Preview build: `READY`, TypeScript и Next.js build прошли.
- Production Vercel build: `READY`, TypeScript и Next.js build прошли.

## Ограничения

- Production deployment выполнен; Vercel aliases: `https://aibook-liart.vercel.app` и
  `https://aibook-azamats-projects-799bf3a6.vercel.app`.
- Vercel env имена проверялись без вывода значений; секреты и env не изменялись.
- SQL migration включена в release, но применение к Supabase из этого worktree не выполнялось.
- `audio_base64` не удалялся и не очищался.
- End-to-end микрофонный сеанс Live Translate в браузере не выполнялся.
