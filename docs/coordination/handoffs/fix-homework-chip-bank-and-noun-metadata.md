# Handoff: быстрый bank чипов и метаданные немецких существительных

- Агент: Codex
- Ветка: `fix/homework-chip-bank-and-noun-metadata`
- Commit: `2b1be64`
- Статус: ready-for-review

## Сделано

- Вернул постоянный ряд чипов над полями упражнения сортировки: поле выбирается один раз, затем можно быстро добавлять несколько слов подряд.
- Выбранные слова исчезают из bank и возвращаются после удаления чипа из поля.
- У выбранного поля есть заметное активное состояние; чипы отключены, пока поле не выбрано или уже заполнено.
- Умное добавление слов теперь применяет общую нормализацию noun-полей. Для немецких слов восстанавливаются `article` и `gender` из `headword`; добавлена небольшая безопасная карта календарных слов для ответов без артикля.
- Старые записи с пустыми noun-полями нормализуются при выдаче словаря, поэтому существующие `der Sommer`, `der Herbst`, `der Winter`, `der Frühling` снова получают родовую окраску без удаления и повторного создания пачки.

## Изменённые области

- `components/homework/SortExercise.tsx`
- `components/homework/HomeworkView.tsx`
- `app/api/dictionary/smart/route.ts`
- `app/api/dictionary/route.ts`
- `lib/ai/buildDictionaryPrompt.ts`
- `lib/db/dictionaryStore.ts`
- `lib/ai/buildDictionaryPrompt.test.ts`

## Проверки

- `npm test` — 450/450 passed.
- `npx tsc --noEmit --incremental false --pretty false` — passed.
- Целевой ESLint изменённых файлов — passed.
- `npm run build` — не завершён в чистой worktree: junction `node_modules` указывает на `D:\DEV\AIBOOK\node_modules`, и webpack не может разрешить Next.js через этот абсолютный путь.
- Browser smoke через `with_server.py` — сервер стартует, но `domcontentloaded` главной страницы не успел завершиться за 30 секунд в той же junction-конфигурации.

## Preview

- URL: не создан

## Риски и продолжение

- Нормализация старых записей при GET исправляет отображение и выдачу словаря; запись в Supabase обновится при следующем импорте/добавлении того же слова.
- Для произвольного немецкого существительного без артикля модель всё ещё должна вернуть корректный артикль; приложение не угадывает род по окончанию.
