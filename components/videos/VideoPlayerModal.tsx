"use client";

import { useEffect, useState, useMemo } from "react";
import { X, ExternalLink, BookOpen, Plus, Check, Volume2 } from "lucide-react";
import { speak } from "@/lib/tts";
import type { VideoItem, VideoVocabularyItem } from "@/lib/videos/types";
import type { Flashcard, UserProfile } from "@/lib/types";
import { createDefaultSrsFields } from "@/lib/srs/sm2";

type Props = {
  video: VideoItem;
  cards: Flashcard[];
  profile: UserProfile;
  relatedVideos: VideoItem[];
  onClose: () => void;
  onSelectVideo: (video: VideoItem) => void;
  onAddCard: (card: Flashcard) => void;
};

export function VideoPlayerModal({
  video,
  cards,
  profile,
  relatedVideos,
  onClose,
  onSelectVideo,
  onAddCard,
}: Props) {
  const [addedWords, setAddedWords] = useState<Set<string>>(new Set());

  // Existing card front words
  const cardFronts = useMemo(
    () => new Set(cards.map((c) => c.front.trim().toLowerCase())),
    [cards]
  );

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleAddVocab(item: VideoVocabularyItem) {
    const front = item.word.trim();
    if (cardFronts.has(front.toLowerCase()) || addedWords.has(front.toLowerCase())) {
      return;
    }

    const srs = createDefaultSrsFields(null, `Видео: ${video.title}`);
    const card: Flashcard = {
      id: `card-video-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: "word",
      source: `Видео: ${video.title}`,
      addedAt: new Date().toISOString(),
      front,
      back: item.translation,
      partOfSpeech: item.partOfSpeech,
      contextSentence: item.example,
      ...srs,
    };

    onAddCard(card);
    setAddedWords((prev) => new Set([...prev, front.toLowerCase()]));
  }

  const youtubeWatchUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;
  const embedUrl = `https://www.youtube.com/embed/${video.youtubeId}?rel=0&modestbranding=1`;

  return (
    <div className="video-modal-backdrop" onClick={onClose}>
      <div
        className="video-modal-content"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={video.title}
      >
        <header className="video-modal-header">
          <div className="video-modal-title-group">
            <h2 className="video-modal-title">{video.title}</h2>
            <div className="video-modal-badges">
              <span className="video-modal-channel">{video.channel}</span>
              {video.cefrLevel && video.cefrLevel !== "all" && (
                <span className="video-badge level-badge">{video.cefrLevel}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="video-modal-close"
            onClick={onClose}
            aria-label="Закрыть плеер"
          >
            <X size={20} />
          </button>
        </header>

        {/* Video Player */}
        <div className="video-player-container">
          <iframe
            src={`https://www.youtube.com/embed/${video.youtubeId}?origin=${typeof window !== "undefined" ? encodeURIComponent(window.location.origin) : ""}&enablejsapi=1`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            className="video-iframe"
          />
        </div>

        {/* Action link */}
        <div className="video-direct-link-bar">
          <a
            href={youtubeWatchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="video-yt-link"
          >
            <ExternalLink size={15} />
            <span>Открыть на YouTube</span>
          </a>
        </div>

        {/* Translation & Description */}
        {video.titleRu && (
          <div className="video-translation-bar">
            <span className="video-translation-label">Перевод:</span>
            <span className="video-translation-text">{video.titleRu}</span>
          </div>
        )}

        {video.description && (
          <p className="video-modal-desc">{video.description}</p>
        )}

        {/* Key Vocabulary */}
        {video.keyVocabulary && video.keyVocabulary.length > 0 && (
          <div className="video-vocab-section">
            <div className="video-vocab-header">
              <h3 className="video-vocab-title">
                <BookOpen size={16} />
                <span>Слова из видео для запоминания</span>
              </h3>
              <span className="video-vocab-count">
                {video.keyVocabulary.length} слов
              </span>
            </div>

            <div className="video-vocab-grid">
              {video.keyVocabulary.map((item) => {
                const isSaved =
                  cardFronts.has(item.word.trim().toLowerCase()) ||
                  addedWords.has(item.word.trim().toLowerCase());

                return (
                  <div key={item.word} className="video-vocab-card">
                    <div className="video-vocab-main">
                      <div className="video-vocab-word-row">
                        <span className="video-vocab-word">{item.word}</span>
                        {item.partOfSpeech && (
                          <span className="video-vocab-pos">
                            {item.partOfSpeech}
                          </span>
                        )}
                        <button
                          type="button"
                          className="video-speak-btn"
                          onClick={() => void speak(item.word, video.language || profile.targetLanguage || "de")}
                          aria-label="Озвучить слово"
                          title="Озвучить слово"
                        >
                          <Volume2 size={15} />
                        </button>
                      </div>
                      <div className="video-vocab-translation">
                        {item.translation}
                      </div>
                      {item.example && (
                        <div className="video-vocab-example">
                          «{item.example}»
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      className={`video-add-card-btn ${isSaved ? "saved" : ""}`}
                      onClick={() => handleAddVocab(item)}
                      disabled={isSaved}
                      aria-label={isSaved ? "В карточках" : "Добавить в карточки"}
                    >
                      {isSaved ? (
                        <>
                          <Check size={14} />
                          <span>В карточках</span>
                        </>
                      ) : (
                        <>
                          <Plus size={14} />
                          <span>В карточки</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Related videos */}
        {relatedVideos.length > 0 && (
          <div className="video-related-section">
            <h3 className="video-related-title">Рекомендованные видео</h3>
            <div className="video-related-grid">
              {relatedVideos.slice(0, 4).map((rel) => (
                <div
                  key={rel.id}
                  className="video-related-card"
                  onClick={() => onSelectVideo(rel)}
                  role="button"
                  tabIndex={0}
                >
                  <img
                    src={
                      rel.thumbnailUrl ||
                      `https://i.ytimg.com/vi/${rel.youtubeId}/mqdefault.jpg`
                    }
                    alt={rel.title}
                    className="video-related-thumb"
                  />
                  <div className="video-related-info">
                    <div className="video-related-channel">{rel.channel}</div>
                    <div className="video-related-name">{rel.title}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
