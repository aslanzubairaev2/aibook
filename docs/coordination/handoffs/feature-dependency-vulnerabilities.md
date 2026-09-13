# Handoff: исправление уязвимых зависимостей

- Агент: Codex
- Ветка: `feature/dependency-vulnerabilities`
- Commit: `a04ade7`
- Статус: ready-for-review

## Сделано

- Обновлены исправленные версии транзитивных зависимостей в `package-lock.json` через `npm audit fix`.
- Next.js обновлён с `16.3.0` до `16.3.5`, а минимальная версия закреплена в `package.json`.
- `sharp` обновлён с `0.35.3` до `0.35.4`.
- Override `@xmldom/xmldom` обновлён с уязвимой `0.9.11` до `0.9.12`.

## Изменённые области

- `package.json` — безопасный минимальный диапазон Next.js и override xmldom.
- `package-lock.json` — воспроизводимые исправленные версии зависимостей.

## Проверки

- `npm audit` — passed, 0 vulnerabilities.
- `npm audit --omit=dev` — passed, 0 vulnerabilities.
- `npm run build` — passed на Next.js 16.3.5.
- `npm test` — 373 passed, 2 существующие несвязанные ошибки в `lib/cards.test.ts` и `lib/srs/activeTraining.test.ts`.
- `npm run lint` — не завершился: полный обход репозитория завис без вывода и был остановлен; изменение касается только package-файлов.
- `git diff --check` — passed для изменённых package-файлов.

## Preview

- URL: не создан

## Риски и продолжение

- В рабочем дереве были оставлены чужие незакоммиченные изменения; в security-коммит они не попали.
- После merge в `main` Vercel должен автоматически создать production deployment через существующую GitHub-интеграцию.
