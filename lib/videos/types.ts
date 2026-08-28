export type VideoCefrLevel = "all" | "A1" | "A2" | "B1" | "B2" | "C1";

export type VideoDurationFilter = "any" | "short" | "medium" | "long";

export type VideoCategory =
  | "all"
  | "dialogues"
  | "grammar"
  | "vocabulary"
  | "stories"
  | "news_culture"
  | "cartoons"
  | "songs";

export type VideoVocabularyItem = {
  word: string;
  translation: string;
  partOfSpeech?: string;
  example?: string;
};

export type VideoItem = {
  id: string;
  youtubeId: string;
  title: string;
  titleRu?: string;
  channel: string;
  language: "de" | "en";
  cefrLevel: VideoCefrLevel;
  category: VideoCategory;
  duration: string;
  thumbnailUrl?: string;
  description?: string;
  tags: string[];
  keyVocabulary?: VideoVocabularyItem[];
  /** Live results are validated before we advertise transcript-based study. */
  hasSubtitles?: boolean;
  /** Curated records are a fallback; network records come from the current YouTube search. */
  source?: "network" | "fallback";
};

export type VideoCategoryMeta = {
  id: VideoCategory;
  title: string;
  description: string;
};

export type VideoFilters = {
  language?: "de" | "en" | "all";
  cefrLevel?: VideoCefrLevel;
  category?: VideoCategory;
  searchQuery?: string;
  duration?: VideoDurationFilter;
  captionsOnly?: boolean;
};

export type VideoSearchIntent = {
  keywords: string;
  cefrLevel: VideoCefrLevel;
  category: VideoCategory;
  duration: VideoDurationFilter;
  captionsOnly: boolean;
};
