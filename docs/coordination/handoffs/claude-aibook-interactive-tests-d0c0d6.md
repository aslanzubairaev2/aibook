# Handoff: интерактивные тесты от преподавательского агента

- Агент: Claude
- Ветка: `claude/aibook-interactive-tests-d0c0d6`
- Commit: см. `git log --grep "interactive tests"`
- Статус: влито в `main` по просьбе владельца

## Сделано

- Новая подсистема «тесты» (отдельно от homework — тот для фото листов живого преподавателя).
- 11 MCP-инструментов: `get_assessment_capabilities`, `create_assessment` (идемпотентно по
  `client_key`), `update_assessment`, `prepare_assessment_audio`, `get_assessment_status`,
  `publish_assessment`, `list_assessments`, `get_assessment_results`, `submit_assessment_review`,
  `get_learning_gaps`, `check_dictionary_words`.
- Типы заданий: один/несколько вариантов, пропуски со списком, пропуски с вводом, порядок слов,
  короткий ответ, письмо; стимулы «текст» и «аудио» (монолог/диалог).
- Режимы learning / diagnostic, момент раскрытия результатов, последовательные блоки, «Не знаю»,
  первый ответ + история, автосохранение черновиков.
- Озвучка на сервере (`gemini-3.8-flash-tts`, настраивается `ASSESSMENT_TTS_MODEL`): диалог из ≤2
  голосов одним запросом (проверено вживую), иначе по репликам со склейкой; статусы, атомарный захват,
  кэш по хэшу спецификации.
- Лимит прослушиваний на сервере (SQL-функция `assessment_start_listen`), без перемотки, ошибка до
  звука не тратит попытку.
- Автопроверка с допуском опечаток (полбалла + орфография + флаг для преподавателя), сводки по навыкам и
  измерениям ошибок, ревью преподавателя поверх автопроверки.
- Экран `/test/<id>` (mobile-first) и строка «Тесты от преподавателя» на главной.

## Изменённые области

- `lib/assessments/*` — модель, проверка, публичное представление, озвучка, БД, тесты.
- `lib/mcp/assessmentTools.ts`, `lib/mcp/tools.ts`, `lib/mcp/capabilities.ts`, `lib/mcp/tools.test.ts`.
- `app/api/mcp/[token]/route.ts` — origin для ссылок.
- `app/api/assessments/*`, `app/test/[id]/page.tsx`, `components/assessment/*`,
  `components/home/HomeDashboard.tsx`, `styles/assessment.css`, `app/layout.tsx`.
- `supabase/migrations/20261002120000_assessments.sql` — **уже применена** к проекту
  `dkvsixwmrgbdmlpydflw`.
- `docs/assessments-mcp.md`, `README.md`.

## Проверки

- `npm test` — passed (521 тест, из них 18 новых).
- `npx tsc --noEmit` — passed.
- `npm run lint` — без новых ошибок.
- `npm run build` — passed.
- Живой сквозной сценарий против прод-базы и Gemini: создание (идемпотентно) → озвучка 2 записей →
  публикация → прохождение в браузере (мобильный вид) → лимит прослушиваний пережил перезагрузку →
  результаты в MCP → ревью письма → результаты у ученика → пачка только из новых слов (затем удалена).

## Preview

- URL: не создан (влито напрямую в `main`).

## Риски и продолжение

- Темп `slow` модель выполняет мягко — слепой судья оценил его как обычный.
- Нет перемотки и «стоп» по дизайну; при желании можно добавить настройку для learning-режима.
- В базе остаётся опубликованный «Демо: проверка A2» (без попыток) — можно удалить через
  `update_assessment(status: "archived")`.
