# Handoff: Режим интерактивного чтения аудиокниг (Audiobook Read-Along)

- **Агент**: Gemini
- **Ветка**: `gemini/audiobook-read-along`
- **Базовый коммит**: `54f1b07` (`origin/main`)
- **Статус**: ready-for-review

---

## 1. Сделано и исправлено

### 1. Интеграция с актуальной версией `main` и чистая Vanilla CSS верстка
1. **Устранение регрессии с версткой**:
   - Полностью убраны Tailwind-классы, которые не компилировались и ломали поток документа.
   - Созданы нативные стили модального оверлея в [`styles/modal.css`](file:///d:/DEV/AIBOOK/styles/modal.css) (`.read-along-backdrop`, `.read-along-modal`, `.read-along-header`, `.read-along-player-bar`, `.read-along-content`, `.read-along-segment`, `.read-along-word`, `.read-along-state-box`).
   - Использованы переменные дизайн-системы AIBook (`var(--bg-primary)`, `var(--bg-secondary)`, `var(--accent)`, `var(--text-primary)`, `var(--text-muted)`, `var(--border)`).
2. **Синхронизация с актуальным `AudiobookDetailModal.tsx`**:
   - Использован актуальный стек `main` (`isBenignPlaybackAbort`, `syncAudioSource`, MediaSession).
   - Кнопка **«Читать текст синхронно (Текст / Караоке)»** стилизована в едином стиле плеера.

### 2. Серверная транскрибация и улучшенная обработка ключей
1. **[`app/api/audiobooks/transcribe/route.ts`](file:///d:/DEV/AIBOOK/app/api/audiobooks/transcribe/route.ts)**:
   - Проверка Supabase DB кэша выполняется в первую очередь: если глава уже транскрибирована, она отдаётся мгновенно без необходимости наличия API ключа.
   - Если требуется онлайн-транскрибация новой главы, а ключ Gemini не указан, клиенту возвращается понятное сообщение на русском языке с подсказкой перейти в Настройки.
   - Интегрирована модель **`gemini-3.5-transcribe`** (с fallback на `gemini-2.0-flash` / `gemini-1.5-flash`) с `word_timestamp: true`.

### 3. Интерактивный AI-разбор в режиме караоке
1. **[`components/discover/AudiobookReadAlongModal.tsx`](file:///d:/DEV/AIBOOK/components/discover/AudiobookReadAlongModal.tsx)**:
   - Кинематографичный тёмный оверлей поверх всего экрана.
   - Немецкая типографика с выделением активного звучащего предложения и автоскроллом.
   - Клик по любому слову ставит аудио на мягкую паузу и поднимает [**`AiPanel`**](file:///d:/DEV/AIBOOK/components/ai-panel/AiPanel.tsx) с переводом, вкладками *«Слово»*, *«Фраза»*, *«Предложение»*, кнопкой *«+ Карточка»*, *«Обсудить»* ([`DiscussAiModal`](file:///d:/DEV/AIBOOK/components/discuss-ai/DiscussAiModal.tsx)) и *«Подробнее»* ([`WordModal`](file:///d:/DEV/AIBOOK/components/word-modal/WordModal.tsx)).

---

## 2. Результаты проверок

- **Unit-тесты**: 33/33 passed (`lib/audio/transcribe.test.ts`, `lib/audio/audiobooks.test.ts`).
- **Визуальная проверка в браузере**: проведена через DevTools MCP, подтверждена корректность центрирования, стилей, таймкодов и работы всплывающей `AiPanel`.

---

## 3. Изменённые и созданные файлы
- [`styles/modal.css`](file:///d:/DEV/AIBOOK/styles/modal.css)
- [`components/discover/AudiobookReadAlongModal.tsx`](file:///d:/DEV/AIBOOK/components/discover/AudiobookReadAlongModal.tsx)
- [`components/discover/AudiobookDetailModal.tsx`](file:///d:/DEV/AIBOOK/components/discover/AudiobookDetailModal.tsx)
- [`app/api/audiobooks/transcribe/route.ts`](file:///d:/DEV/AIBOOK/app/api/audiobooks/transcribe/route.ts)
- [`lib/types.ts`](file:///d:/DEV/AIBOOK/lib/types.ts)
- [`lib/audio/transcribe.ts`](file:///d:/DEV/AIBOOK/lib/audio/transcribe.ts)
- [`lib/audio/transcribe.test.ts`](file:///d:/DEV/AIBOOK/lib/audio/transcribe.test.ts)
