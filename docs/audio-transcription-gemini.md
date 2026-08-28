# Интеграция Gemini Audio Transcription в AIBook

## 1. Обзор технологии Gemini для аудио и транскрибации

Google Gemini — это нативно мультимодальная модель, которая умеет напрямую принимать аудиопотоки (`.mp3`, `.wav`, `.aac`, `.ogg`) без использования промежуточных сторонних ASR (Whisper и др.).

### Доступные модели:
- **`gemini-3.7-flash` / `gemini-3.5-transcribe`**: новейшие быстрые модели Google с расширенным контекстом, высочайшей точностью распознавания речи и понимания контекста.
- **`gemini-2.5-flash` / `gemini-2.0-flash`**: стабильные высокопроизводительные модели для работы со звуком.
- **`gemini-1.5-flash` / `gemini-1.5-pro`**: поддержка аудио до 9.5 часов за один запрос.

---

## 2. Архитектура транскрибации аудиокниг в AIBook

```
[ LibriVox / Archive.org MP3 ]
               │
               ▼
[ Next.js API Route (/api/audiobooks/transcribe) ]
               │
               ├─► 1. Проверка Supabase DB Cache (таблица `audiobook_transcripts`)
               │      (если уже транскрибировано — мгновенная отдача клиенту)
               │
               ├─► 2. Скачивание аудио во временный файл (os.tmpdir())
               │
               ├─► 3. Загрузка в Google GenAI Files API (`ai.files.upload`)
               │      (поддержка аудиофайлов до 2 ГБ)
               │
               ├─► 4. Запрос к Gemini (`ai.models.generateContent` / `ai.interactions.create`)
               │      с JSON-схемой (дословный текст, таймкоды start/end, слова)
               │
               ├─► 5. Автоудаление временного файла и файла из Google Storage
               │
               └─► 6. Сохранение результата в Supabase DB + возврат клиенту
```

---

## 3. Спецификация формата ответа модели

```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 4.8,
      "text": "Kapitel 1 von Alice's Abenteuer im Wunderland von Lewis Carroll."
    },
    {
      "start": 4.8,
      "end": 11.8,
      "text": "Dies ist eine LibriVox-Aufnahme. Alle LibriVox-Aufnahmen sind in der Public Domain, frei von Urheberrechten."
    }
  ]
}
```

---

## 4. Клиентский караоке-плеер (Read-Along)

- **Интерфейс**: Нативный Vanilla CSS (`styles/modal.css`), адаптированный под мобильные и десктопные экраны.
- **Синхронизация**: При проигрывании активный сегмент подсвечивается золотой рамкой, страница плавно скроллится за диктором (`scrollIntoView`).
- **Интерактивность**: При клике по любому слову воспроизведение мягко приостанавливается, открывается `AiPanel` с грамматикой, переводом и кнопкой добавления в SRS-карточки.
