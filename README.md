# AIBook — AI Language Learning Reader

> **v1.1.0** · Mobile-first PWA · Next.js 16 · Gemini AI · Supabase Cloud

An intelligent application for learning foreign languages through reading. Open a book, tap on any word, and receive an instant analysis: translation, grammar, context, and examples. Listen to the text with interactive karaoke highlighting and sync your progress across all devices.

---

## Screenshots

| Home | Reader | AI Panel | Flashcards |
|--------|---------|-----------|---------|
| Dashboard with progress | Book text with highlights | Word/phrase analysis | List of saved words |

---

## New in v1.1.0 🚀

### 🎙️ Audio & TTS (Karaoke Mode)
- **Interactive Audio**: Listen to any sentence or paragraph using high-quality AI voices.
- **Dual Engine**: Support for **Google Gemini TTS** (natural AI voices) and **Native Browser TTS** (offline capability).
- **Karaoke Highlighting**: Real-time visual tracking of spoken words. The text highlights as the audio plays.
- **Audio Scrubber**: Precise control over playback with seeking, pausing, and repeat mode.

### ☁️ Cloud Sync (Supabase)
- **Multi-device Sync**: Your library, reading progress, and flashcards are now synced to the cloud via Supabase.
- **Persistent Profile**: Save your native language and target language preferences across sessions.
- **Progress Tracking**: Never lose your place in a book, even if you switch devices.

### 🧠 Global AI Cache
- **Cost Efficiency**: Shared global cache for word and sentence analysis. If another user has already analyzed a word, you get the result instantly without an API call.
- **Performance**: Instant dictionary lookups for frequently used words.

---

## Core Features

### Book Library
- Load **TXT** and **EPUB** files from the device.
- Automatic parsing and text splitting into paragraphs.
- Book language detection via filename (`_de`, `-en`, `-fr`, `-es`).
- Books are stored locally and synced to the cloud for authenticated users.

### Reader & AI Analysis
- **Context-Aware Analysis**: Tap any word to get its lemma, part of speech, grammar (gender, case), and context-specific translation.
- **Phrase Detection**: Automatic detection of idioms, collocations, and compound words.
- **Sentence Breakdown**: Full translation and structural analysis of the containing sentence.
- **Interactive Examples**: 5 usage examples for every word. Tap any word within the examples to explore further!

### Flashcards (SRS Ready)
- Save words, phrases, or sentences with one click.
- Automatic back-side generation using AI analysis.
- Status tracking: `new`, `due`, `learning`.

---

## Usage Guide & Workflow

### 1. Setting Up
- **API Key**: Go to **Settings** and enter your Google Gemini API Key.
- **Languages**: Choose your **Native Language** (for explanations) and **Target Language**.

### 2. The Reading Workflow
1. **Import**: Open **Library**, click **"+"**, and upload your book.
2. **Read**: Tap a book cover to start. Scroll naturally; your progress is saved automatically.
3. **Explore**:
   - **Tap a word**: Opens the bottom panel with quick info.
   - **Open Modal**: Click the expand icon for deep analysis and usage examples.
   - **Interactive Examples**: Tap words inside the examples to see their definitions without leaving the current context.
4. **Listen**:
   - Tap the **Speaker** icon to start playback.
   - Watch the **Karaoke Highlighting** to associate sounds with text.
   - Use the **Scrubber** at the bottom to replay specific parts.
5. **Save**: Click the **Save** icon in the AI panel to add the word/phrase to your flashcards.

### 3. Reviewing
- Open the **Flashcards** tab to review your vocabulary. Your progress here is synced to your account.

---

## Architecture

```
aibook/
├── app/
│   ├── layout.tsx           # Root layout, PWA metadata, CSS imports
│   ├── page.tsx             # Main SPA router (section state machine)
│   ├── auth/                # Auth pages (Login/Signup)
│   └── api/
│       └── ai/
│           └── analyze/
│               └── route.ts # Server-side proxy → Gemini API
│
├── components/
│   ├── ui/
│   │   ├── AppShell.tsx     # Application shell with bottom navigation
│   │   ├── AudioScrubber.tsx # Interactive TTS controls
│   │   └── SpeakButton.tsx  # TTS trigger
│   ├── auth/                # Authentication components
│   ├── home/                # Dashboard widgets
│   ├── library/             # File upload, book list
│   ├── reader/              # Reader view with word highlighting
│   ├── ai-panel/            # Side panel for AI analysis
│   ├── word-modal/          # Modal window for word analysis
│   ├── cards/               # Flashcards list
│   └── settings/            # Settings & Profile
│
├── lib/
│   ├── ai/                  # Gemini API logic & prompts
│   ├── auth/                # Supabase Auth hooks
│   ├── db/                  # LocalStorage & Supabase CRUD
│   ├── parser/              # TXT/EPUB parsers
│   ├── tts.ts               # TTS Engine (Gemini/Browser)
│   └── config.ts            # App constants
│
├── styles/                  # Vanilla CSS design system
└── public/                  # PWA assets & manifest
```

---

## Technology Stack

| Technology | Role |
|-----------|------|
| **Next.js 16** | Framework |
| **React 19** | UI Library |
| **Supabase** | Auth, Database, Cloud Sync |
| **Gemini AI** | Text Analysis & TTS |
| **epubjs** | EPUB Parsing |
| **Lucide** | Icons |

---

## Roadmap (v1.2+)

- [x] Cloud synchronization via Supabase
- [x] AI Audio / TTS with Karaoke
- [x] Global AI Caching
- [ ] Flashcard review mode (Spaced Repetition — SRS)
- [ ] PDF format support
- [ ] Flashcard export to Anki
- [ ] Multi-word range selection (tap and hold)
- [ ] Dark / Light theme toggle

---

## Privacy
Your data is private. While we use cloud sync, your Gemini API key remains in your local storage and is never stored on our servers.

---

## License
ISC © 2025
