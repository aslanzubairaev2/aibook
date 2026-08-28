# AIBook — правила работы AI-агентов

Этот файл является общим контрактом для Claude, Gemini, Codex и других AI-агентов,
работающих над репозиторием.

## Язык и контекст

- Общение с владельцем проекта, планы, handoff-файлы и описания изменений — на русском.
- Перед изменениями прочитай `README.md`, относящиеся к задаче файлы и документацию из `docs/`.
- Не переписывай и не откатывай чужие незакоммиченные изменения.
- Не добавляй секреты, `.env.local`, токены, ключи API или персональные данные в Git.

## Git-контракт

- `main` — production; прямые коммиты запрещены.
- Работай в отдельной ветке: `feature/<краткое-имя>`, `fix/<краткое-имя>` или `chore/<краткое-имя>`.
- Один агент — одна ветка. Claude Cloud и Gemini Local не должны работать в одной ветке.
- Перед началом проверь `git status` и зафиксируй границы своей задачи.
- Делай небольшие атомарные commits с понятным сообщением.
- Не используй `git reset --hard`, `git checkout --`, массовое удаление или перезапись чужих файлов.
- Не мержи чужие ветки самостоятельно без явного задания координатора.

## Работа параллельно

- Старайся владеть отдельными файлами или подсистемой.
- Если требуется изменить файл, который сейчас меняет другой агент, сначала зафиксируй это в handoff-файле.
- После завершения создай `docs/coordination/handoffs/<имя-ветки>.md` по шаблону из `docs/coordination/README.md`.
- В handoff укажи: что сделано, какие файлы изменены, commit, проверки, Preview URL и оставшиеся риски.
- Не изменяй handoff-файлы других веток.

## Качество

Перед передачей работы выполни подходящие проверки:

```bash
npm run lint
npm test
npm run build
```

Если проверка не запускалась или не прошла, укажи это явно. Для UI проверь mobile-first поведение,
состояния загрузки/ошибки/пустого результата, клавиатурную доступность и отсутствие регрессий в
существующих компонентах.

Не добавляй дубликаты компонентов или новые библиотеки без необходимости. Следуй существующей
архитектуре Next.js App Router, Vanilla CSS, Supabase и offline-first хранилищ.

## Коммуникация

- Канонический порядок работы и handoff-протокол находятся в `docs/coordination/README.md`.
- Архитектурные решения фиксируются в `docs/coordination/decisions.md` координатором.
- Статус задачи, если он нужен до завершения, хранится в отдельном файле внутри
  `docs/coordination/handoffs/`, а не в общем редактируемом журнале.


<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
