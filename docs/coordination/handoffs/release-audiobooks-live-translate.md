# Handoff: release аудиокниг и Live Translate

- Агент: Codex
- Ветка: `release/audiobooks-pause`
- База: `release/audiobooks-pause` (`25ed19ab`)
- Интеграционный commit: `0f3b0cdfc1ef1cae15ed41cb0e91588ea5741fe1`
- Preview deployment: https://aibook-aj09tjlil-azamats-projects-799bf3a6.vercel.app
- Статус Preview: `READY`

## Вошло в release

- Audiobooks home quality из `feature/audiobooks-home-quality` (`db77a0d`): честная CEFR-классификация,
  рекомендации на главной, Media Session и устойчивое воспроизведение.
- Live Translate MVP из `feature/live-translate-mvp` (`6b02638`, `b898098`): отдельный экран,
  ephemeral-token route и поток Gemini Live.
- Конфликты разрешены только в `HomeDashboard.tsx` и `package.json`: сохранены аудиокнижные изменения,
  добавлены иконка Live Translate и оба набора тестов.

## Проверки

- Целевые тесты аудиокниг, Media Session и Live Translate: `42/42 passed`.
- Полный `npm test`: `245 passed`; локально не завершились тесты, требующие отсутствующих
  `ws`, `@google/genai`, `@supabase/supabase-js`, а также два известных timezone-зависимых падения
  в `lib/cards.test.ts` и `lib/srs/activeTraining.test.ts`.
- Локальные `tsc`, `npm run lint`, `npm run build`: заблокированы отсутствующими локальными зависимостями
  и `EACCES` при попытке npm обратиться к registry.
- Удалённый Vercel build Preview: `READY`, TypeScript и Next.js build прошли.

## Ограничения

- Production deployment не выполнялся: для новых изменений требовалось дополнительное подтверждение;
  подготовлен рабочий Preview.
- Vercel Preview содержит `GEMINI_API_KEY`; значение не раскрывалось и env не изменялись.
- Supabase, TTS Storage и `audio_base64` не изменялись и не удалялись.
- End-to-end микрофонный сеанс Live Translate в браузере не выполнялся.
