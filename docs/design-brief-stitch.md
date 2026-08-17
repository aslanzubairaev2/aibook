# AIBook — дизайн-бриф для Google Stitch

Документ, который нужно скормить [Google Stitch](https://stitch.withgoogle.com/),
чтобы он перерисовал приложение и при этом точно знал: какие экраны есть, что на
каждом из них лежит, что откуда открывается и в каких состояниях бывает.

Собран из кода на `claude/google-sketch-design-9ef4v1` (v1.1.0), а не из головы:
все подписи в промптах — те же строки, что реально в интерфейсе.

---

## 0. Как этим пользоваться

Stitch генерирует **по одному экрану за раз** и плохо держит длинный контекст.
Поэтому бриф разбит так:

1. **Раздел 1 (глобальный контекст)** — вставляете первым сообщением в новый
   проект. Он задаёт продукт, платформу, палитру, шрифты, навигацию.
2. **Раздел 4 (промпты по экранам)** — вставляете по одному, в порядке
   очерёдности. Каждый промпт самодостаточный: если Stitch «забудет» контекст,
   экран всё равно соберётся правильно.
3. **Раздел 5 (оверлеи)** — модалки и шторки. Их генерируйте после того, как
   базовый экран под ними вас устраивает: просите «same screen, with X sheet
   open over it».
4. **Раздел 6 (состояния)** — пустые/загрузка/ошибка. Это отдельные генерации,
   Stitch сам их не придумает.

Практические заметки по инструменту:

- Промпты **пишите по-английски**, а подписи интерфейса оставляйте
  **русскими в кавычках** — так и сделано ниже. Модель заметно точнее следует
  английским инструкциям, а русские строки просто отрисовывает как есть.
- Ставьте режим **Mobile**, а не Web: приложение mobile-first PWA.
- В режиме **Vibe Design** (описываете ощущение, а не компоненты) хорошо
  прогонять раздел 1 + один экран, чтобы получить 3-4 направления. Дальше
  фиксируете направление и добиваете остальные экраны обычными промптами.
- Скриншоты текущего приложения можно загружать как референс — Stitch принимает
  картинки на вход. Это лучший способ сказать «вот это оставь, вот это поменяй».
- Экспорт: в Figma и в Firebase Studio. Код из Stitch — Tailwind-подобная
  разметка, а здесь **vanilla CSS с токенами** (`styles/globals.css`), так что
  код берите как источник значений (отступы, размеры, иерархия), а не копипастой.
- Лимит — дневные кредиты. Не тратьте их на состояния загрузки, пока не
  утверждён основной вид экрана.

---

## 1. Глобальный контекст (вставить первым сообщением)

```
I am redesigning "AIBook" — a mobile-first PWA for learning foreign languages by
reading books. The user opens a book, taps any word, and gets an instant AI
analysis: translation, grammar, context, examples. Words are saved as flashcards
and reviewed with spaced repetition. There is also text-to-speech with karaoke
highlighting, an AI voice chat partner, and a catalogue of free books and
AI-generated lessons.

Audience: adult self-learners, mostly reading German/English at A2-B2 level.
Primary usage: one-handed, on a phone, often in the evening, for long sessions.
The interface language is Russian.

Platform: mobile web (PWA), 390x844 baseline, safe-area insets respected.
Persistent bottom navigation bar with 5 items, always visible except in the
reader and in full-screen modals.

Visual direction — keep this identity:
- Dark, warm, "old paper by lamplight". Never cold grey, never pure black.
- Background #141210, secondary surfaces #1e1b16, elevated #272319, cards #2c2820.
- Primary text #ede3cf, muted text #7a6e5e.
- Single accent: warm gold #d4a847 (bright #f0c060). Semantic: green #7aab6a,
  blue #6a98c4, red #c46a6a. Use accent sparingly — it marks the one action that
  matters on a screen.
- Borders are accent at low alpha: rgba(212,168,71,0.14), strong 0.38.
- Soft radial gold glow at the top of the page background.
- Radii 8 / 12 / 16 / 20 px. Shadows deep and soft, never harsh.
- UI font: Inter (400-900). Reading font: Lora serif — used ONLY for book text.
- Density: generous vertical rhythm, 16px side padding, big tap targets (44px+).

Tone: calm and literary, not gamified. No mascots, no confetti, no neon.
```

---

## 2. Дизайн-система (справочно, для сверки)

Токены живут в `styles/globals.css`. Stitch про них знать не обязан построчно,
но если попросит «design system», давайте вот это:

| Группа | Значения |
|---|---|
| Фоны | `--bg-primary #141210`, `--bg-secondary #1e1b16`, `--bg-elevated #272319`, `--bg-card #2c2820` |
| Светлые поверхности | `--surface #f4ead7`, `--surface-dim #c8b898` |
| Текст | `--text-primary #ede3cf`, `--text-dark #141210`, `--text-muted #7a6e5e` |
| Акцент | `--accent #d4a847`, `--accent-bright #f0c060`, `--accent-dim #8a6a20` |
| Семантика | `--green #7aab6a`, `--blue #6a98c4`, `--red #c46a6a` |
| Подсветка в тексте | предложение `rgba(212,168,71,0.13)`, фраза `0.4`, слово — сплошной золотой с тёмным текстом |
| Радиусы | 8 / 12 / 16 / 20 |
| Шрифты | UI — Inter; чтение — Lora |
| Анимации | 140ms / 260ms / 420ms, `cubic-bezier(0.16,1,0.3,1)` |

Повторяющиеся паттерны, которые стоит просить у Stitch как **компоненты**:

- `action-card` — крупная кликабельная карточка: иконка слева, три строки текста
  (label / title / sub), шеврон справа.
- `glass-card` — карточка с полупрозрачным фоном и золотой рамкой.
- `progress-bar` — тонкая полоса прогресса чтения.
- `pill-btn` / `primary-btn` / `icon-btn` — три уровня кнопок.
- `filter-chip` — чипы фильтров (уровень, часть речи, статус).
- `settings-list` / `setting-row` — строка настройки: label + value + контрол справа.
- `empty-state` — иконка, заголовок, поясняющий абзац.
- `shimmer-line` / скелетоны полок.
- Bottom sheet со «шторкой» (`panel-handle-bar`) — базовый носитель AI-панели.

---

## 3. Карта экранов

Приложение — SPA с одним state machine (`app/page.tsx`), разделы:
`home · discover · books · reader · cards · settings · auth`.

Нижняя навигация (5 пунктов, иконки Lucide):

| Пункт | Иконка | Раздел |
|---|---|---|
| Главная | Home | `home` |
| Каталог | Globe | `discover` |
| Книги | Library | `books` |
| Карточки | SquareStack | `cards` |
| Настройки | Settings | `settings` |

Экраны вне навигации: **Читалка** (открывается из книги, возвращает туда,
откуда пришли) и **Вход** (открывается из настроек).

Схема переходов:

```
Главная ──"Продолжить"──────────────► Читалка ──назад──► откуда пришли
   ├──иконка Library───────────────► Книги
   ├──иконка Phone─────────────────► Голосовой чат (модалка)
   ├──заголовок полки──────────────► Каталог
   └──карточка SRS─────────────────► Карточки

Каталог ──таб «Мои уроки»/«Словарь»─► внутри того же экрана
   ├──книга──► BookDetailModal ──"Читать"──► Читалка
   ├──FAB камера──► Урок из фотографии (модалка)
   └──FAB палочка──► Новый урок (модалка)

Книги ──"+"──► С компьютера / Из каталога
   └──книга──► Читалка

Читалка ──тап по слову──► AI-панель (шторка) ──"подробнее"──► WordModal
   ├──иконка перевода──► TranslationModal / BulkActionSheet (оценка стоимости)
   ├──иконка динамика──► TTS + караоке + AudioScrubber
   └──иконка телефона──► Голосовой чат по этому тексту

Карточки ──табы Сегодня / Тренировка / Все карточки
   ├──"Разбор"──► панель статистики
   └──дзен-режим (полноэкранная тренировка)

Настройки ──"Войти или зарегистрироваться"──► Вход
```

---

## 4. Промпты по экранам

### 4.1 Главная (`home`)

```
Screen: "Главная" (Home). Bottom nav item 1 of 5, active.

Header row: app title "AIBook" on the left; on the right two round icon
buttons — a phone icon (opens AI voice chat) and a library icon.

Guest banner (only when signed out): rounded card with a subtle gold gradient,
title "☁️ Локальный офлайн-режим", body "Вы вошли как гость. Ваш прогресс чтения
и карточки хранятся только в браузере. Зарегистрируйтесь, чтобы сохранять данные
в облаке."

Continue-reading hero card (when a book is open): book cover thumbnail on the
left (or a colored gradient block with the language code, e.g. "DE"), then title,
author, a thin progress bar, and a caption "Глава 3 · 42%". A gold primary
button "Продолжить" pinned to the card.
If no book is open, replace the hero with a large action card: book icon, label
"Начать читать", title "Загрузите первую книгу", subtitle "TXT, EPUB или FB2",
chevron right.

Spaced-repetition action card: flame icon (green when there is work due), label
"Есть карточки для повторения", title "Повторить сегодня: 24", subtitle
"Укрепите нейронные связи прямо сейчас", chevron right. When nothing is due the
same card reads "Все карточки повторены" / "Интервальное повторение" /
"Всего изучено: 130 из 210" in muted grey.

Two horizontal shelves of book recommendations. Each has a tappable section
heading with a chevron ("На Deutsch", "Лучшие книги") and a horizontally
scrolling row of book covers, ~6 visible, each with a title and author below in
two lines max.

"Книга дня" card at the bottom: wide horizontal card, cover on the left, small
label "Книга дня", then title and author in italic, chevron right.

Everything scrolls vertically under a fixed bottom navigation bar.
```

### 4.2 Каталог (`discover`)

```
Screen: "Каталог" (Catalogue). Bottom nav item 2 of 5, active.

Header: small uppercase eyebrow "Каталог материалов", then large title
"Открытая библиотека".

Scrollable tab strip with 5 tabs: "Классика", "Клексикон", "CEFR тексты",
"Мои уроки", "Словарь". Active tab in gold.

Below the tabs, a search row: rounded search input with placeholder
"Название, автор, тема", a clear (×) button, a gold "Найти" button, and a
compact language dropdown ("Все языки", "Немецкий", "Английский", …).

Second filter row of dropdowns, depending on the tab: CEFR level
("Все уровни", A1…C2) and status ("Любой статус", "Не начатые", "В процессе",
"Прочитанные"), plus a reset-filters icon button.

Results meta line: "128 книг" on the left, "Страница 2 из 8" on the right.

Results as a grid of book cards, 3 per row: cover (image or colored gradient
with the language code), title in two lines, author in muted small text, and an
optional gold badge "В библиотеке". Cards with a CEFR level show a small level
pill (A2, B1, "≈B1" when the level is estimated).

Pagination controls at the bottom of the list.

Floating action buttons in the bottom-right corner, above the nav bar, stacked
vertically: a camera FAB ("Урок из фотографии") and a wand FAB ("Новый урок").
On the "Словарь" tab the camera FAB reads "Сфотографировать слова".

Fixed bottom navigation bar.
```

Дополнительно попросите два варианта содержимого этого же экрана:

```
Same screen, "Мои уроки" tab: a vertical list of AI-generated lesson cards —
title, language + CEFR pill, a one-line topic summary, a reading-progress bar,
and a small overflow menu with "Доработать" and "Удалить".

Same screen, "Словарь" tab: vocabulary grouped into "пачки" (batches) captured
from photos. Filter chip groups above the list, each with a small label:
"Уровень" (Все, A1…C2), "Часть речи" (Все, сущ., гл., прил., нар.), "Тип
глаголов" (Все, Правильные, Неправильные). Then collapsible batch sections:
batch title, word count, a "тренировать" button, a delete icon; inside each,
rows of "das Fenster — окно" with a part-of-speech tag and an add-to-flashcards
button.
```

### 4.3 Книги (`books`)

```
Screen: "Книги" (My library). Bottom nav item 3 of 5, active.

Header: eyebrow "Библиотека", title "Книги", and a round "+" icon button on the
right that expands into two action cards: "С компьютера" (upload icon) and
"Из каталога" (globe icon), side by side.

Main content: vertical list of imported books. Each row — cover thumbnail on the
left (image, or a gradient block with the language code), then title in bold,
author in muted text, a thin gold progress bar, and on the right the percentage
"42%" plus a delete icon button.

The whole screen is also a drag-and-drop target: when a file is dragged over it,
a full-screen dashed gold overlay appears with a large "Отпустите файл здесь".

Fixed bottom navigation bar.
```

### 4.4 Читалка (`reader`)

Самый важный экран — просите его отдельными итерациями.

```
Screen: the reader. Full-screen, NO bottom navigation bar.

Top toolbar, compact and translucent over the page background:
- back arrow (left)
- centered book title with the chapter name beneath it in small muted text
- a row of icon buttons on the right: bookmark/anchor ("Сохранить якорь
  прочитанного"), phone ("Обсудить этот текст голосом"), translate ("Перевести
  весь текст"), speaker ("Озвучить весь текст")
- reading percentage "42%" and a hairline progress bar along the bottom edge of
  the toolbar

Body: the book text set in Lora serif, 18-19px, line-height 1.7, generous side
margins, warm cream #ede3cf on the dark background. Paragraphs separated by
space, not indents.

Word interaction states shown in the text (this is the heart of the product):
- the tapped word: solid gold background #d4a847 with dark text, small radius
- the detected phrase around it: gold at 40% opacity
- the containing sentence: gold at 13% opacity
Show all three nested in one paragraph so the hierarchy is visible.

A small gold anchor marker sits in the left margin next to the line where the
reader last stopped.

Page controls at the bottom of the text column: previous / next arrows and
"Страница 3 из 27".
```

Затем — шторка анализа поверх читалки:

```
Same reader screen with the AI analysis bottom sheet open over the lower half.

The sheet: rounded top corners, elevated dark surface, a small drag handle bar
at the top. Header row of the sheet has, on the right, a toggle for auto-advance,
a TTS engine selector, previous/next arrows, and a close button.

Tabs inside the sheet: "Слово", "Фраза", "Предложение". Active tab in gold.

"Слово" tab content: the word large in Lora, its lemma and part of speech as
small pills, grammar details (gender, case) in muted text, the context-specific
translation in bold cream, a speaker button to hear it, a bookmark button to save
it as a flashcard, and a text button "подробнее" on the right.

Below, a short list of usage examples; every word inside the examples is itself
tappable (show a faint underline affordance).

The book text above the sheet stays visible and keeps its highlight.
```

И режим озвучки:

```
Same reader screen in audio (karaoke) mode: the sentence being read is
highlighted at low gold opacity and the word currently spoken has the solid gold
background. Above the bottom sheet sits an audio scrubber bar: play/pause,
a draggable progress track with elapsed and total time, a repeat toggle, and
a playback-speed control.
```

### 4.5 Карточки (`cards`)

```
Screen: "Карточки" — spaced repetition. Bottom nav item 4 of 5, active.

Header: back arrow on the left, eyebrow "Интервальное повторение" with the title
"Карточки" beneath it, and an icon button on the right that jumps to all cards.

Summary block: a very large gold number "37" with the caption "повторений
осталось" (or "на сегодня всё"), a secondary line "18 сделано сегодня · 12 карт.",
and a small chip with the number of cards ever reviewed. On the right, a small
outlined button "Разбор" with a chevron that expands a statistics panel.

Statistics panel (expanded state): four sections, each with a small section
label and a muted note on the right —
1. "Освоение трёх направлений" (note "начато 88 из 210 · 42%") with three
   labelled bars: "Узнавание", "Воспроизведение", "Аудирование".
2. "Осталось сегодня" with the remaining count, or the line "Всё повторено —
   можно отдыхать или читать."
3. "Состояние колоды" (note "показатели независимы и могут пересекаться") with
   three horizontal stat bars: "Трудные" in red, "Не начаты" in gold, "Зрелые"
   in green — each showing value / total.
4. "Прогноз на неделю" (note "назначенных повторений") — a 7-column bar chart,
   weekday labels under each column, today labelled "сегодня"; a legend with two
   swatches: "сделано сегодня" and "назначено".
5. "По источникам" (note "книги и пачки из словаря") — a short list of source
   titles with counts, plus a muted line "и ещё 4 источник(ов)".

Segmented tab bar: "Сегодня" (with a count badge), "Тренировка", "Все карточки"
(with a count badge). The active tab has a raised card background and gold text;
badges are gold pills.

"Сегодня" tab: a row with "К повторению (12):" on the left and a gold pill
button "▶ Начать тренировку" on the right, then a list of due cards. Each card
row shows the front text in Lora, the translation in muted text below, a small
source line "из «Der Prozess»", three tiny skill dots for the three directions,
a "discuss with AI" icon and a delete icon.

Fixed bottom navigation bar.
```

Отдельно — сам тренажёр (дзен-режим):

```
Screen: flashcard training, "дзен" mode. Full-screen, no tabs, no filters, no
bottom navigation — the card is the only thing on screen.

Centered card: large word in Lora on an elevated dark surface, a speaker button
under it, and, before the answer is revealed, a wide muted button "Показать
ответ". After reveal, the translation, the grammar line and one example sentence
appear on the card.

Grading row pinned below the card: four equal-width buttons in one row, each with
an interval hint above the label — "Снова" (red outline), "Трудно" (blue),
"Хорошо" (green), "Легко" (gold). Buttons must NOT move between cards: reserve
their space so the position is identical every time.

Under the grading row, a compact history strip of the cards graded in this
session: small chips with the word and the grade colour, scrollable, tappable to
review a previous card read-only.

A small counter in the corner: "7 / 24". An exit affordance in the top corner.
```

И «активная практика»:

```
Screen: productive practice exercise. A prompt in the native language at the top
("Скажите: «Я забыл ключи дома»"), a large text input for the answer, a
microphone button "Ответить голосом" beside it, and a "Проверить" button. After
checking, an AI feedback block appears: the corrected sentence with the changed
words highlighted in gold, and one short explanation line.

Empty state variant: check-circle icon in green, "Активная практика выполнена",
"На сегодня нет упражнений на воспроизведение. Добавьте новые слова при чтении
или вернитесь позже."
```

### 4.6 Настройки (`settings`)

```
Screen: "Настройки" (Settings). Bottom nav item 5 of 5, active.

Header: eyebrow "Профиль", title "Настройки".

Grouped settings list. Each group has a small uppercase gold-muted section title
above a rounded card containing rows. A row is: label on the left, current value
in muted text under it, control on the right (a compact select, a switch, or a
button).

Groups and rows, in order:

1. "Аккаунт" — "Email" with the address as the value; "Синхронизация активна"
   with a green dot.
2. "Интеграция AI" — "Использовать AI" (select: "Выключен" / "Свой ключ Gemini
   API"); when a key is used, a full-width row "Gemini API Key" with a masked
   password input and a "Показать" / "Скрыть" text button.
3. "Подключение ИИ‑агентов (MCP)" — an explanatory paragraph, a gold button
   "Показать мою ссылку", and, once revealed, a monospace URL in a scrollable
   box with a "Скопировать ссылку" button that becomes "✓ Скопировано".
4. "Языки" — "Родной язык" (select) and "Изучаемый язык" (select).
5. Voice rows — "Голосовой движок", "Модель", "Голос" (all selects), and
   "Пример" whose control is a small button "▶ Послушать" that changes to "…"
   while playing.
6. "О приложении" — read-only rows: "Версия 1.1.0", "AI модель", "Модель
   обсуждения", "Форматы книг: TXT, EPUB, FB2", "Хранилище".

Bottom: a full-width destructive button "Выйти из аккаунта" — red text on a
translucent red background with a red border.

Signed-out variant: instead of the sign-out button, a section "Синхронизация
данных" with the note "Данные сохраняются только на этом устройстве. Войдите,
чтобы синхронизировать." and a gold primary button "Войти или зарегистрироваться".

Fixed bottom navigation bar.
```

### 4.7 Вход (`auth`)

```
Screen: sign in / sign up. Full-screen, no bottom navigation, a back arrow in
the top-left.

Centered column: the "AIBook" wordmark, the subtitle "Читайте и изучайте языки",
then a card with a segmented switch between "Вход" and "Регистрация".

Form: "Email" label with an input (placeholder "your@email.com"), "Пароль" label
with a password input (placeholder "••••••••") and a show/hide eye button,
a full-width gold primary button, and below it a text link that toggles between
"Нет аккаунта? Зарегистрируйтесь" and "Уже есть аккаунт? Войдите".

Error state: a red-tinted inline message above the button.

Same warm dark background with the gold radial glow at the top.
```

---

## 5. Оверлеи и модалки

Генерируйте поверх уже готового экрана: «same screen, with … open over it».

| Оверлей | Что внутри | Откуда |
|---|---|---|
| **AI-панель** | Табы Слово / Фраза / Предложение, перевод, грамматика, примеры, кнопки сохранить/озвучить/подробнее | тап по слову в читалке |
| **WordModal** | Полный разбор: лемма, часть речи, род/падеж, инфинитив с кнопкой «в карточки», 5 примеров, в каждом слова тапабельны | «подробнее» в AI-панели |
| **GrammarModal** | Таблица форм (склонение/спряжение) | из WordModal |
| **TranslationModal** | Перевод всего абзаца/главы рядом с оригиналом | иконка перевода в читалке |
| **BulkActionSheet** | Оценка перед дорогой операцией: «Объём», «Примерно звучания», «Токенов на входе», «Уже готово», «Стоимость», кнопка «▶ Слушать» | озвучка/перевод целиком |
| **Голосовой чат** | Полноэкранный «звонок»: выбор сценария («Как будем практиковать этот текст?»), переключатель режима, лента реплик, «Варианты ответа», поле ввода, «Сказать медленнее», красная кнопка «Завершить звонок» | иконка телефона |
| **Обсудить с AI** | Чат вокруг цитаты «…», объясняет как сказать, а не как назвать | иконка на карточке / в панели |
| **Урок из фотографии** | Камера → кроппер с рамкой → «Текст на снимке — Немецкий» → выбор языка (метка «вы учите») → «Отменить» / создать | FAB в каталоге |
| **BookDetailModal** | Обложка, аннотация, язык, кнопки «Скачать» / «Читать», прогресс скачивания | тап по книге на полке |
| **LessonComposerModal** | Тема, язык, уровень → «Создать текст» | FAB «Новый урок» |
| **LessonRefineModal** | Что поправить в готовом уроке | меню урока |
| **ApiErrorModal** | Ошибка ключа/квоты + ссылка в настройки | глобально |
| **ConnectivityBanner** | Полоса «нет сети», офлайн-режим | глобально, поверх шапки |

---

## 6. Состояния, которые надо нарисовать отдельно

Stitch по умолчанию рисует «счастливый путь». Эти состояния просите явно —
в приложении они встречаются постоянно:

**Пустые:**
- Книги: иконка, «Книг пока нет», «Загрузите TXT, EPUB или FB2 файл, чтобы начать читать и изучать язык».
- Карточки/Сегодня: зелёная галочка, «Вы полностью свободны!», «На сегодня все карточки успешно повторены. Отдыхайте или читайте новые книги.»
- Каталог: глобус, «Книги не найдены», «Попробуйте другой запрос или язык».
- Уроки: «Уроков пока нет», «Задайте тему — текст будет написан под ваш уровень».
- Словарь: «Словарь пуст», «Сфотографируйте страницу со словами — она станет пачкой…».
- Не вошёл: «Войдите, чтобы вести словарь» / «Войдите, чтобы генерировать уроки».

**Загрузка:**
- Полки на главной — скелетоны: серый блок обложки + две мерцающие строки.
- Импорт книги — «Разбираем книгу…», «Это займёт несколько секунд».
- Каталог — инлайн «Загружаю каталог…» с пульсирующей точкой.
- Длинная операция (импорт статей) — прогресс с потоковым логом.

**Ошибки:**
- Инлайн-плашка красным поверх контента: «Не удалось загрузить голоса.», «Не удалось загрузить словарь.», «Ошибка при загрузке файла».
- Тосты: «Такая карточка уже есть», «Текст создан — смотрите в «Мои уроки»».

---

## 7. Чего от Stitch ждать не стоит

- **Точной типографики читалки.** Караоке-подсветка, три уровня выделения и
  якорь — это то, ради чего приложение существует; Stitch их упростит. Тут
  берите его макет как направление, а верстку правьте руками в `styles/reader.css`.
- **Плотных экранов со статистикой.** Панель «Разбор» он почти наверняка
  разложит слишком воздушно. Просите «compact, data-dense, tabular numbers».
- **Стабильности между экранами.** Одинаковые компоненты он рисует по-разному от
  генерации к генерации. Лечится тем, что вы фиксируете один экран как эталон,
  скармливаете его картинкой и пишете «match the components of this screenshot».
- **Русских строк без опечаток.** Проверяйте подписи глазами; в макете они
  нужны только как ориентир — в коде строки уже есть.

---

## Приложение: чек-лист генерации

- [ ] Раздел 1 вставлен, направление выбрано
- [ ] Главная
- [ ] Каталог (+ вкладки «Мои уроки», «Словарь»)
- [ ] Книги
- [ ] Читалка (базовая)
- [ ] Читалка + AI-шторка
- [ ] Читалка + режим озвучки
- [ ] Карточки (список + «Разбор»)
- [ ] Тренажёр (дзен)
- [ ] Активная практика
- [ ] Настройки
- [ ] Вход
- [ ] Голосовой чат
- [ ] Урок из фотографии
- [ ] Пустые состояния (6 шт.)
- [ ] Состояния загрузки и ошибок
