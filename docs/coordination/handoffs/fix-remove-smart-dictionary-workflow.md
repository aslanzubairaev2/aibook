# Handoff: вернуть простое создание пачки слов

- Агент: Codex
- Ветка: `fix/remove-smart-dictionary-workflow`
- Commit: `c4c4ce9d331c21d3b02c8fbe9574e1badabe2342`
- Статус: ready-for-review

## Сделано

- Остановлена runaway-задача в production; активных job генерации больше нет.
- Smart Dictionary снова выполняет один AI-запрос и сразу сохраняет одну пачку.
- Убраны фоновые Workflow/job routes, polling, раунды и общий баннер фоновой задачи.
- Оставлено чтение существующих слов пачки, чтобы добавление в пачку не дублировало её содержимое.
- Описание новой пачки формируется по фактическому числу слов одного ответа.

## Изменённые области

- `app/api/dictionary/smart/route.ts` — одношаговая генерация и сохранение.
- `components/dictionary/DictionaryView.tsx` — удалён UI фоновой задачи.
- `components/dictionary/SmartAddWordsModal.tsx` — удалены фоновые состояния и раунды.
- `lib/ai/smartDictionary.ts`, `next.config.ts`, `package.json`, `package-lock.json`, `styles/*` — удалены runtime-зависимости и стили Workflow.
- Удалены `workflows/smartDictionary.ts`, job API и job storage.

## Проверки

- `npm run lint` — failed: 73 существующие ошибки в несвязанных файлах проекта.
- `npx eslint app/api/dictionary/smart/route.ts components/dictionary/SmartAddWordsModal.tsx lib/ai/smartDictionary.ts next.config.ts` — passed.
- `npm test` — passed, 428/428.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed; в маршрутах остался только `/api/dictionary/smart`, без Workflow/job routes.

## Preview

- URL: https://aibook-liart.vercel.app
- Inspect: https://vercel.com/azamats-projects-799bf3a6/aibook/3pKAEin3T5kg5BWCXagMST9LAyEh

## Риски и продолжение

- Уже сохранённые 97 слов из остановленной старой задачи не удалялись.
- Историческая migration `dictionary_generation_jobs` не удалена; код её больше не использует.
- Fast-forward в `main` выполнен до `c2dcc77`; production deploy `dpl_3pKAEin3T5kg5BWCXagMST9LAyEh` получил статус `READY`.
