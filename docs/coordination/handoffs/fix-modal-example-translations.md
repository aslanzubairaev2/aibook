# Handoff: выравнивание переводов примеров в модалке

- Агент: Codex
- Ветка: `fix/modal-example-translations`
- Commit: `25efebc`
- Статус: ready-for-review

## Сделано

- Перевод примера перенесён в ту же колонку, что и оригинальная фраза.
- Убрано смещение перевода вправо через `padding-left: 24px`.
- Inline-стили блока примера заменены на именованные CSS-классы.

## Изменённые области

- `components/word-modal/WordModal.tsx` — структура строки примера и перевод.
- `styles/modal.css` — раскладка оригинала, кнопок и перевода.

## Проверки

- `npx eslint components/word-modal/WordModal.tsx` — passed
- `npm test` — failed: 2 существующих падения в `lib/cards.test.ts` и `lib/srs/activeTraining.test.ts`, не связанных с модалкой; 321 passed, 2 failed
- `npm run build` — passed

## Preview

- URL: не создан

## Риски и продолжение

- В рабочем дереве до начала задачи уже были изменения других агентов; они оставлены нетронутыми.
- Нужна визуальная проверка модалки на мобильной ширине после интеграции.
