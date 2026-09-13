# Handoff: упрощение спряжения и дневной прогресс глаголов

- Агент: Codex
- Ветка: `feature/verb-quiz-daily-progress`
- Commit: `3292600`
- Статус: ready-for-review

## Сделано

- Для отделяемых немецких глаголов (`einkaufen → kaufe ein`) приставка определяется по сохранённому `trennbar`-признаку и показывается как автоматически добавляемая часть.
- В ответе вводится только изменяемая основа; проверка сама добавляет приставку, диктовка и вставка полного варианта также нормализуются.
- Для `wir` и `sie/Sie` у отделяемых глаголов основа блокируется, если совпадает с основой инфинитива (`kaufen ein`); исключения не блокируются.
- Слово помечается завершённым на текущий локальный календарный день только после успешного прохождения всех выбранных шагов этого слова.
- При повторном входе в тренажёр завершённые сегодня слова исключаются из общей тренировки, пачек, незнакомых и сложных фильтров; на следующий день они снова доступны.
- Если в пачке на сегодня больше нечего проходить, кнопка показывает `Сегодня всё пройдено` и отключается.

## Изменённые области

- `components/verbs/VerbsQuiz.tsx` — автодобавление приставок и завершение слова после всех шагов.
- `components/verbs/VerbsView.tsx` — исключение завершённых сегодня слов из очередей и UI пачек.
- `lib/verbForms.ts` — безопасное выделение отделяемой приставки и обработка plural-основ.
- `lib/verbForms.test.ts` — тесты отделяемых форм и plural-исключений.
- `lib/srs/packProgress.ts` — локальный дневной ключ и отметка завершённого слова.
- `lib/srs/usePackProgress.ts` — сохранение дневного завершения в local storage.
- `lib/srs/packProgress.test.ts` — тест дневного пропуска и сброса на следующий день.
- `styles/globals.css` — визуальный сегмент автоматически добавляемой приставки.

## Проверки

- `node --experimental-strip-types --import ./scripts/register-test-loader.mjs --test lib/verbForms.test.ts lib/srs/packProgress.test.ts` — passed (20/20)
- `npm run build` — passed
- `npm test` — 373 passed, 2 existing failures in `lib/cards.test.ts` and `lib/srs/activeTraining.test.ts`.
- Targeted `npx eslint ...` — existing error at `components/verbs/VerbsView.tsx:127` (`react-hooks/set-state-in-effect`), unrelated to this change.
- `npm run lint` — not rerun; repository-wide command previously scans generated `.next` files and other worktrees and reports baseline errors.

## Preview

- URL: не создан

## Риски и продолжение

- Приставка выделяется только если AI/словарь сохранил `forms.trennbar` как `да`, `ja`, `yes`, `true` или `1`; это защищает от ошибочного выделения неотделяемых приставок.
- Завершение дня относится к выбранным режимам текущего запуска: если пользователь вышел до прохождения всех выбранных режимов слова, оно останется в очереди.
