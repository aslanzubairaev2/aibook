# AIBook — AI Language Learning Reader

> **v1.0.0** · Mobile-first PWA · Next.js 16 · Gemini AI

An intelligent application for learning foreign languages through reading. Open a book, tap on any word, and receive an instant analysis: translation, grammar, context, and examples. Save words to flashcards for later review.

---

## Screenshots

| Home | Reader | AI Panel | Flashcards |
|--------|---------|-----------|---------|
| Dashboard with progress | Book text with highlights | Word/phrase analysis | List of saved words |

---

## Features v1.0.0

### Book Library
- Load **TXT** and **EPUB** files from the device
- Automatic parsing and text splitting into paragraphs
- Book language detection via filename (`_de`, `-en`, `-fr`, `-es`)
- All books are stored locally in the browser (localStorage) — no cloud, no registration required
- Remove books from the library
- Colored covers for visual distinction of books

### Reader
- Paragraph-by-paragraph reading mode
- Forward/backward navigation with automatic progress saving
- Highlighting of the selected word upon tapping
- Progress bar displaying the percentage read
- Quick return button to the main menu without losing current position

### AI Word Analysis (Gemini API)
- **Word Tap** → comprehensive analysis via Google Gemini:
  - Dictionary form (lemma) and part of speech
  - Grammatical gender (e.g., der/die/das for German)
  - Translation of the word into the user's native language
  - Contextual explanation (1-2 sentences)
- **Phrase**: automatic detection of collocations with type identification (idiom / collocation / compound word)
- **Sentence**: full translation, grammar note, and structural breakdown
- **5 usage examples** of the word in natural language
- Result caching in localStorage (24h) to optimize API requests
- Support for custom Gemini API key via settings

### Flashcards
- Save a word, phrase, or sentence to a flashcard with a single click directly from the AI panel
- List of all flashcards including the addition date and source (book → word)
- Card status tracking: `new` / `due` / `learning`
- All flashcards are stored locally in the browser

### Settings
- Selection of **native language** (for UI and explanations)
- Selection of **target language** (book language for analysis)
- Input for custom **Gemini API key** (stored securely in localStorage)
- Statistics tracking: reading minutes, books started/finished, saved flashcards

### Main Dashboard
- "Continue Reading" widget featuring the last opened book
- Quick navigation to the library and flashcards
- Overall profile statistics

---

## Architecture

```
aibook/
├── app/
│   ├── layout.tsx           # Root layout, PWA metadata, CSS imports
│   ├── page.tsx             # Main SPA router (section state machine)
│   └── api/
│       └── ai/
│           └── analyze/
│               └── route.ts # Server-side proxy → Gemini API
│
├── components/
│   ├── ui/
│   │   └── AppShell.tsx     # Application shell with bottom navigation
│   ├── home/
│   │   └── HomeDashboard.tsx
│   ├── library/
│   │   └── LibraryView.tsx  # File upload, book list
│   ├── reader/
│   │   └── ReaderView.tsx   # Reader view with word highlighting
│   ├── ai-panel/
│   │   └── AiPanel.tsx      # Side panel for AI analysis
│   ├── word-modal/
│   │   └── WordModal.tsx    # Modal window for word analysis
│   ├── cards/
│   │   └── CardsView.tsx    # Flashcards list
│   └── settings/
│       └── SettingsView.tsx
│
├── lib/
│   ├── types.ts             # TypeScript definitions (Book, Flashcard, AiAnalysis…)
│   ├── config.ts            # Constants: AI model, languages, formats
│   ├── ai/
│   │   ├── analyze.ts       # Client-side fetch → /api/ai/analyze
│   │   ├── buildAnalysisPrompt.ts  # Prompt generation for Gemini
│   │   └── mockAnalyze.ts   # Stub for offline development
│   ├── db/
│   │   ├── local.ts         # CRUD operations in localStorage
│   │   └── supabase.ts      # Supabase client (preparation for cloud sync)
│   └── parser/
│       ├── index.ts         # Format router (txt / epub)
│       ├── txt.ts           # TXT parser → paragraphs
│       └── epub.ts          # EPUB parser utilizing epubjs
│
├── styles/
│   ├── globals.css          # Design system: tokens, components, animations
│   ├── reader.css           # Reader styles
│   ├── panel.css            # AI panel styles
│   ├── modal.css            # Modal window styles
│   └── highlight.css        # Selected word highlight styles
│
└── public/
    └── manifest.json        # PWA manifest
```

---

## Technology Stack

| Technology | Version | Role |
|-----------|--------|------|
| Next.js | 16 | Full-stack framework (App Router) |
| React | 19 | UI Library |
| TypeScript | 6 | Static typing |
| Google Gemini API | gemini-flash-lite | AI language analysis |
| epubjs | 0.3 | EPUB parsing |
| Lucide React | 1.16 | Iconography |
| localStorage | — | Data persistence |
| Supabase | 2.x | Cloud storage (preparation) |

---

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/aslanzubairaev2/aibook.git
cd aibook
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
GEMINI_API_KEY=your_gemini_key
# Optional — for future cloud synchronization:
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Obtain a Gemini API Key: https://aistudio.google.com/apikey

### 4. Run in development mode

```bash
npm run dev
```

Open http://localhost:3000 in your browser (or on a mobile device connected to the same network).

---

## Usage Guide

1. **Add a book**: Navigate to the "Library" tab → click the "+" icon → select a `.txt` or `.epub` file.
2. **Read**: Tap on a book to open the reader at the first paragraph.
3. **Analyze a word**: Tap any word to display the AI analysis panel at the bottom.
4. **Save a flashcard**: In the AI panel, click "Save" next to the desired item (word, phrase, or sentence).
5. **Review**: Access the "Flashcards" tab to view all saved items.
6. **Settings**: Navigate to the "Settings" tab to change languages or update your API key.

---

## Supported Languages

Target languages (book language): **German, English, French, Spanish**

Interface and explanation languages: **Russian, English, German, Spanish, French**

---

## Privacy and Security

- **All data is stored locally** in your browser via localStorage.
- The Gemini API key is securely stored only in your device's localStorage.
- During word analysis, the current sentence and its adjacent context are transmitted to the Gemini API.
- Cloud synchronization (Supabase) is planned for v2.

---

## Roadmap (v2+)

- [ ] Flashcard review mode (Spaced Repetition System — SRS)
- [ ] Cloud synchronization via Supabase
- [ ] PDF format support
- [ ] Multi-word range selection (tap and hold)
- [ ] Flashcard export to Anki
- [ ] Reading statistics and vocabulary progress tracking
- [ ] Dark / Light theme toggle
- [ ] PWA: Install to mobile home screen

---

## License

ISC © 2025
