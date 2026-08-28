export type VideoCefrLevel = "all" | "A1" | "A2" | "B1" | "B2" | "C1";

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
};
