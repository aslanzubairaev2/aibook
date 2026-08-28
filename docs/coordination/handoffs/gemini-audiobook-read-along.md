# Handoff: Режим интерактивного чтения аудиокниг (Audiobook Read-Along)

- **Агент**: Gemini
- **Ветка**: `gemini/audiobook-read-along`
- **Commit**: `1306ad8`
- **Базовый коммит**: `f5f66c0` (`gemini/audiobooks-quality`)
- **Статус**: ready-for-review

---

## 1. Сделано

### Часть 1. Архитектура данных и серверная транскрибация
1. **Типы данных (`lib/types.ts`)**:
   - `AudiobookWordTimestamp`: слово и таймкоды `start`/`end` в секундах.
   - `AudiobookSegment`: предложение/фрагмент текста с таймкодами и опциональным массивом слов.
   - `AudiobookTranscript`: структура полного транскрипта главы.
2. **Серверный роут (`app/api/audiobooks/transcribe/route.ts`)**:
   - Проверяет кэш в Supabase (`audiobook_transcripts`).
   - Если нет в кэше — загружает аудиопоток главы из Internet Archive CDN и обращается к **`gemini-3.5-transcribe`** (с fallback на `gemini-2.0-flash` / `gemini-1.5-flash`) с конфигурацией `word_timestamp: true`.
   - Нормализует таймкоды и границы предложений.
   - Сохраняет результат в базу и возвращает клиенту.
3. **Утилиты и кэширование (`lib/audio/transcribe.ts`)**:
   - Поиск активного сегмента (`findActiveSegmentIndex`) с устойчивостью к микропаузам между фразами.
   - Поиск активного слова (`findActiveWordIndex`).
   - Клиентское кэширование в `localStorage` для мгновенного повторного открытия (0 мс задержки).

---

### Часть 2. Полноэкранный кинематографичный UI и интерактив
1. **Компонент оверлея (`components/discover/AudiobookReadAlongModal.tsx`)**:
   - Тёмная тема (`#0b0f19`) с фокусом на типографике.
   - Встроенный верхний плеер: Play/Pause, перемотка на 10 сек, переключение глав, скорость (0.75x–1.5x), таймлайн со скраббером, переключатель автоскролла.
   - Караоке-подсветка активного предложения в реальном времени по `currentTime` аудио.
   - Плавный автоскролл за диктором.
2. **Полный интерактивный разбор слов и предложений**:
   - Каждое слово в тексте разбивается через `splitIntoTokens` / `normalizeToken` и доступно для тапа.
   - При тапе: аудио мягко ставится на паузу, снизу открывается [**`AiPanel`**](file:///d:/DEV/AIBOOK/components/ai-panel/AiPanel.tsx) со вкладками *«Слово»*, *«Фраза»*, *«Предложение»*.
   - Доступны кнопки **«+ Карточка»** (сохранение в SRS с контекстной цитатой), **«Разбор слова»** ([`WordModal`](file:///d:/DEV/AIBOOK/components/word-modal/WordModal.tsx)) и **«Обсудить с AI»** ([`DiscussAiModal`](file:///d:/DEV/AIBOOK/components/discuss-ai/DiscussAiModal.tsx)).
3. **Интеграция в плеер (`components/discover/AudiobookDetailModal.tsx`)**:
   - Добавлена кнопка «Читать текст синхронно (Текст / Караоке)».
   - Передача состояния воспроизведения и синхронизация между окнами.

---

## 2. Результаты тестов и проверок

- **Unit-тесты транскрипта и аудиокниг**:
  `node --experimental-strip-types --import ./scripts/register-test-loader.mjs --test lib/audio/transcribe.test.ts lib/audio/audiobooks.test.ts`
  **13/13 passed** (0 failures).

---

## 3. Изменённые и созданные файлы
- [`lib/types.ts`](file:///d:/DEV/AIBOOK/lib/types.ts)
- [`lib/audio/transcribe.ts`](file:///d:/DEV/AIBOOK/lib/audio/transcribe.ts)
- [`lib/audio/transcribe.test.ts`](file:///d:/DEV/AIBOOK/lib/audio/transcribe.test.ts)
- [`app/api/audiobooks/transcribe/route.ts`](file:///d:/DEV/AIBOOK/app/api/audiobooks/transcribe/route.ts)
- [`components/discover/AudiobookReadAlongModal.tsx`](file:///d:/DEV/AIBOOK/components/discover/AudiobookReadAlongModal.tsx)
- [`components/discover/AudiobookDetailModal.tsx`](file:///d:/DEV/AIBOOK/components/discover/AudiobookDetailModal.tsx)
- [`components/discover/DiscoverView.tsx`](file:///d:/DEV/AIBOOK/components/discover/DiscoverView.tsx)
- [`docs/coordination/handoffs/gemini-audiobook-read-along.md`](file:///d:/DEV/AIBOOK/docs/coordination/handoffs/gemini-audiobook-read-along.md)
