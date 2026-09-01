# Handoff: skeleton загрузки модалок спряжения

- Агент: Codex
- Ветка: `feature/ai-tutor-agent`
- Commit: `не создан — Git lock refs недоступен в текущем окружении`
- Статус: ready-for-review

## Сделано

- Добавлены skeleton-состояния загрузки для модалки грамматических форм.
- Для режима «Кратко» показываются секции со строками форм.
- Для режима «Полная» у глаголов показывается широкая skeleton-матрица, повторяющая структуру таблицы и поддерживающая горизонтальный скролл на мобильных экранах.
- Добавлена анимация shimmer с поддержкой `prefers-reduced-motion`.

## Изменённые области

- `components/word-modal/GrammarModal.tsx` — разметка skeleton для brief/full и доступный статус загрузки.
- `styles/modal.css` — стили секционного и матричного skeleton.

## Проверки

- `node_modules/.bin/tsc.cmd --noEmit` — passed
- `npm test` — 321 passed, 2 existing failures в `lib/cards.test.ts` и `lib/srs/activeTraining.test.ts`, не связаны с этой задачей
- `npm run build` — passed
- `npx eslint components/word-modal/GrammarModal.tsx` — зависла без вывода, остановлена

## Preview

- URL: не создан

## Риски и продолжение

- Проверить визуально открытие обеих вкладок при медленном ответе API на мобильной ширине.
- Закоммитить только файлы этой задачи и handoff после восстановления доступа Git к lock-файлу refs.
