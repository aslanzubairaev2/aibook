# Спецификация и инструкция: Модуль «Аудиокниги» (Audiobooks)

> Ветка: `feature/audiobooks`  
> Статус: Проектирование и разработка  
> Дата: 2026-08-28

---

## 1. Цель и назначение фичи

Добавить в раздел каталога (**Discover**) полноценную поддержку **аудиокниг** (LibriVox, Project Gutenberg Audio, Internet Archive) с мгновенной загрузкой, обложками, пагинацией, фильтрацией по языкам и уровням CEFR, встроенным AI-обзором, чатом с AI о книге и HTML5-аудиоплеером с поддержкой фонового воспроизведения и сохранения прогресса.

---

## 2. Источники данных и API

1. **Internet Archive Search & Metadata API (быстрый основной провайдер)**:
   - **Поиск / Каталог:** `https://archive.org/advancedsearch.php?q=collection:(librivoxaudio)+AND+language:({lang})&fl[]=identifier,title,creator,description,language,publicdate,downloads,item_size,subject&sort[]=downloads+desc&rows={pageSize}&page={page}&output=json`
   - **Обложки:** `https://archive.org/services/img/{identifier}` (CDN-кэш, автогенерация качественного превью).
   - **Детали и главы (MP3):** `https://archive.org/metadata/{identifier}` — возвращает список файлов (`VBR MP3` / `64Kbps MP3`), названия глав (`title`) и длительность (`length`).
   - **Стриминг аудио:** `https://archive.org/download/{identifier}/{filename}` (без CORS-блокировок, прямой streaming в `<audio>`).

2. **LibriVox API (вспомогательный)**:
   - `https://librivox.org/api/feed/audiobooks/?id={id}&extended=1&format=json`

---

## 3. Фильтры и маппинг CEFR

1. **Языковой фильтр (`language`)**:
   - `de` (Немецкий — приоритет, 850+ аудиокниг)
   - `en` (Английский — 15 000+)
   - `fr` (Французский), `es` (Испанский), `ru` (Русский), `it` (Итальянский) и др.

2. **Фильтр уровней CEFR (A1–C2)**:
   - **A1 / A2**: Детские сказки, басни, короткие рассказы (`subject:("fairy tales" OR "children" OR "short stories" OR "märchen" OR "fabeln")`, братья Гримм, Андерсен, сказки Бехштейна).
   - **B1 / B2**: Приключенческая литература, новеллы, короткая классическая проза (Цвейг, Кафка, Конан Дойл, Жюль Верн).
   - **C1 / C2**: Полные классические романы, драма, философия (Гёте, Шиллер, Ницше, Томас Манн).
   - **AI-валидация**: При открытии книги `gemini-3.1-flash-lite` формирует точную оценку уровня языка.

---

## 4. Архитектура и переиспользование компонентов

1. **Вкладка в каталоге (`components/discover/DiscoverView.tsx`)**:
   - Добавление новой вкладки `audio` ("Аудиокниги") в `TAB_LABELS`.
   - Карточки аудиокниг используют стандартные CSS-классы `.book-card`, `.book-cover`, `.cefr-badge` и генератор фона `pickColor(title)`.
   - Иконка наушников (`Headphones` / `Volume2`) для обозначения аудио-формата и длительности (например, `4 ч 15 мин`).
2. **Модальное окно аудиокниги (`components/discover/AudiobookDetailModal.tsx`)**:
   - Переиспользует стиль и компоновку `BookDetailModal.tsx` (`.book-modal`, `.ai-review-card`, `.book-chat-card`).
   - Переиспользует `aiChat` (`lib/ai/chat.ts`) для 4-строчного AI-обзора и живого чата с AI о книге.
   - Включает аудиоплеер с главами, кнопками плей/пауза, перемоткой ±15с, ползунком громкости и селектором скорости (0.75x — 2.0x).
3. **Хранилище прогресса**:
   - Локальное сохранение текущей главы и секунды прослушивания в `localStorage` / IndexedDB (`lib/db/local.ts`).

---

## 5. Инструкция для последующих агентов

- При модификации UI не ломать существующие вкладки (`classic`, `klexikon`, `cefr`, `lessons`, `dictionary`).
- Стили должны добавляться в `styles/globals.css` или `styles/modal.css` с использованием переменных `:root`.
- Любые сетевые вызовы к API делать с обработкой ошибок и fallback на локальные заглушки.
