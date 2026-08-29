export type VideoPlaylistPreset = {
  id: string;
  title: string;
  description: string;
  query: string;
  language: "de" | "en";
};

/**
 * These are search presets, not a hardcoded video catalogue. Selecting one
 * sends its query to the live YouTube search so new videos can appear.
 */
export const VIDEO_PLAYLISTS: VideoPlaylistPreset[] = [
  {
    id: "german-from-zero",
    title: "Немецкий с нуля",
    description: "Уроки для начинающих",
    query: "немецкий язык с нуля уроки A1",
    language: "de",
  },
  {
    id: "polyglot-german-16-hours",
    title: "Полиглот: немецкий за 16 часов",
    description: "Курс Дмитрия Петрова",
    query: "Полиглот немецкий за 16 часов Петров",
    language: "de",
  },
  {
    id: "nicos-weg",
    title: "Nicos Weg",
    description: "Немецкий от Deutsche Welle",
    query: "Nicos Weg Deutsch lernen",
    language: "de",
  },
  {
    id: "easy-german",
    title: "Easy German",
    description: "Живая речь и интервью",
    query: "Easy German Deutsch lernen",
    language: "de",
  },
  {
    id: "english-from-zero",
    title: "Английский с нуля",
    description: "Уроки для начинающих",
    query: "learn English from zero beginner lessons",
    language: "en",
  },
];
