# Handoff: модуль «Личные местоимения» в Практике

- Агент: Claude
- Ветка: `claude/aibook-personal-pronouns-82ef26`
- Commit: см. `git log` ветки
- Статус: ready-for-review

## Сделано

- Новый тренажёр в «Практике»: Nominativ + Akkusativ, люди и замена существительного, режимы выбор /
  пропуски / письмо / голос, 7 уровней как включаемые блоки, настройки, статистика.
- Проверка ответа правилами по компонентам (подлежащее, дополнение, спряжение с учётом выбранного
  подлежащего, тип предложения, порядок слов, управление, приставка, отрицание, орфография); роль-своп —
  одна ошибка; неуверенная проверка → `needs_review`; голосовые сбои → `technical`.
- Адресный повтор: после ошибки — задание с выбором на ту же трудность, перепроверка через несколько
  заданий, отсроченный повтор в следующих сессиях. Первый ответ не заменяется исправлением.
- События в общей `training_events` (trainer `pronouns`, outcome `needs_review` добавлен).
- MCP: фильтры в `get_training_summary` / `get_training_history`, блок в `get_learning_gaps`, новые
  `get_pronoun_practice_config`, `update_pronoun_practice_config`, `create_pronoun_practice_session`,
  `submit_pronoun_answer_review`. Версия MCP 1.11.0.
- Документация: `docs/pronoun-practice-mcp.md`.

## Изменённые области

- `lib/pronouns/*` — каталог, настройки, задания, проверка, статистика, хранилище, тесты.
- `components/pronouns/*`, `app/practice/pronouns/[id]`, `app/api/pronoun-practice/*`.
- `lib/training/{events,client,store}.ts`, `lib/assessments/store.ts` (gaps), `lib/mcp/*`.
- `lib/speech/recognition.ts` — `onResult` получает необязательную уверенность (совместимо).
- `components/practice/PracticeView.tsx`, `app/page.tsx`, `lib/types.ts`, `components/ui/AppShell.tsx`.
- `supabase/migrations/20261020120000_pronoun_practice.sql` — **уже применена** к базе AIBOOK.

## Проверки

- `npm test` — passed (565)
- `npx tsc --noEmit` — passed
- `npm run build` — passed
- `npm run lint` — новые файлы чистые; в репозитории остаются старые ошибки линтера (не тронуты).
- Живая проверка в приложении: тренировка, роль-своп, исправление, адресное задание, вариант `hoeren`,
  сбой микрофона → «технический» + переход на текст, статистика, ссылка преподавателя; MCP: создание
  сессии (идемпотентно), отказ на Dativ, история с фильтрами, пересмотр оценки, gaps.

## Preview

- URL: не создан (проверено локально).

## Риски и продолжение

- Голосовой режим не проверен живым голосом (микрофон в панели браузера заблокирован). Распознавание —
  Web Speech API; аудио не хранится, показатели произношения не измеряются (поле предусмотрено).
- В истории владельца остались проверочные ответы от 2026-10-20 (около 5 событий trainer `pronouns`,
  1 ревью, 1 закрытая сессия `claude-verify-pronouns-1`).
