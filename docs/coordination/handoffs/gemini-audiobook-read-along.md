# Handoff: Режим интерактивного чтения аудиокниг (Audiobook Read-Along)

- **Агент**: Gemini
- **Ветка**: `gemini/audiobook-read-along`
- **Базовый коммит**: `f5f66c0` (`gemini/audiobooks-quality`)
- **Статус**: in-progress

---

## 1. Описание задачи
Реализация режима синхронизированного чтения аудиокниг (*Read-Along / Караоке*):
1. По требованию транскрибируется текущая глава аудиокниги (оригинальный текст на немецком/английском) через **Gemini 3.5 Transcribe** (`word_timestamp: true`) с поглавным кэшированием в базе данных.
2. Полноэкранный кинематографичный тёмный интерфейс чтения с караоке-подсветкой активного фрагмента синхронно с речью диктора.
3. Полная интерактивность как в читалке книг: тап по любому слову открывает `AiPanel` (перевод слова, фразы, предложения), `WordModal` (морфология, формы), `DiscussAiModal` (вопрос к AI по контексту) и добавление в карточки SRS.

---

## 2. Изменяемые и создаваемые файлы
- `lib/types.ts` — типы `AudiobookSegment`, `AudiobookWordTimestamp`, `AudiobookTranscript`.
- `app/api/audiobooks/transcribe/route.ts` — серверный эндпоинт транскрибации аудио с Gemini 3.5 Transcribe и кэшированием.
- `lib/audio/transcribe.ts` — клиентские/серверные утилиты работы с транскриптом.
- `lib/audio/transcribe.test.ts` — unit-тесты парсинга и синхронизации таймкодов.
- `components/discover/AudiobookReadAlongModal.tsx` — оверлей караоке-чтения с интерактивным разбором текста.
- `components/discover/AudiobookDetailModal.tsx` — кнопка переключения в режим чтения в аудиоплеере.

---

## 3. Изоляция и риски
- Ветка не затрагивает чужие незакоммиченные файлы.
- Worktree Claude `audiobooks-ux-redesign-6ef7a9` изолировано; логика `AudiobookReadAlongModal` вынесена в отдельный самодостаточный компонент.
