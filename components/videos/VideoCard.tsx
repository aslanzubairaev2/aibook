"use client";

import { Play, Clock, BookOpen } from "lucide-react";
import type { VideoItem } from "@/lib/videos/types";

type Props = {
  video: VideoItem;
  onSelect: (video: VideoItem) => void;
};

export function VideoCard({ video, onSelect }: Props) {
  const thumb =
    video.thumbnailUrl ||
    `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`;

  return (
    <article
      className="video-card"
      onClick={() => onSelect(video)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect(video);
        }
      }}
      tabIndex={0}
      role="button"
      aria-label={`Смотреть видео: ${video.title}`}
    >
      <div className="video-thumb-wrap">
        <img
          src={thumb}
          alt={video.title}
          className="video-thumb"
          loading="lazy"
        />
        <div className="video-thumb-overlay">
          <div className="video-play-icon">
            <Play size={22} fill="currentColor" />
          </div>
        </div>

        {video.duration && (
          <span className="video-badge duration-badge">
            <Clock size={11} />
            <span>{video.duration}</span>
          </span>
        )}

        {video.cefrLevel && video.cefrLevel !== "all" && (
          <span className="video-badge level-badge">{video.cefrLevel}</span>
        )}
      </div>

      <div className="video-card-body">
        <div className="video-card-channel">{video.channel}</div>
        <h3 className="video-card-title">{video.title}</h3>
        {video.titleRu && (
          <p className="video-card-subtitle">{video.titleRu}</p>
        )}

        {video.keyVocabulary && video.keyVocabulary.length > 0 && (
          <div className="video-card-meta">
            <span className="video-vocab-chip">
              <BookOpen size={12} />
              <span>{video.keyVocabulary.length} слов к уроку</span>
            </span>
          </div>
        )}
      </div>
    </article>
  );
}
