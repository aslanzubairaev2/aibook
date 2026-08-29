import { GoogleGenerativeAI } from "@google/generative-ai";
import { AI_CONFIG } from "@/lib/config";
import type { VideoCategory, VideoCefrLevel, VideoDurationFilter, VideoSearchIntent } from "./types";

const LEVELS = new Set<VideoCefrLevel>(["all", "A1", "A2", "B1", "B2", "C1"]);
const CATEGORIES = new Set<VideoCategory>(["all", "dialogues", "grammar", "vocabulary", "stories", "news_culture", "cartoons", "songs"]);
const DURATIONS = new Set<VideoDurationFilter>(["any", "short", "medium", "long"]);

function parseIntent(text: string, fallbackKeywords: string): VideoSearchIntent {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  const raw = JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned) as Partial<VideoSearchIntent>;
  const level = typeof raw.cefrLevel === "string" ? raw.cefrLevel.toUpperCase() as VideoCefrLevel : "all";
  return {
    keywords: typeof raw.keywords === "string" && raw.keywords.trim() ? raw.keywords.trim() : fallbackKeywords,
    cefrLevel: LEVELS.has(level) ? level : "all",
    category: CATEGORIES.has(raw.category as VideoCategory) ? raw.category as VideoCategory : "all",
    duration: DURATIONS.has(raw.duration as VideoDurationFilter) ? raw.duration as VideoDurationFilter : "any",
    captionsOnly: raw.captionsOnly === true,
  };
}

export async function buildVideoSearchIntent(apiKey: string, query: string, language: "de" | "en"): Promise<VideoSearchIntent> {
  const languageName = language === "de" ? "German" : "English";
  const prompt = `Turn this learner's request into a concise YouTube search intent for ${languageName} learning videos. Return JSON only with: keywords (in the target language), cefrLevel (all|A1|A2|B1|B2|C1), category (all|dialogues|grammar|vocabulary|stories|news_culture|cartoons|songs), duration (any|short|medium|long; short ≤5min, medium 5–15min, long >15min), captionsOnly (boolean). Do not invent a level or category when the request does not specify it. Request: ${query}`;
  const model = new GoogleGenerativeAI(apiKey).getGenerativeModel({
    model: AI_CONFIG.model,
    generationConfig: { responseMimeType: "application/json", maxOutputTokens: 220, temperature: 0 },
  });
  const result = await model.generateContent(prompt);
  return parseIntent(result.response.text(), query);
}
