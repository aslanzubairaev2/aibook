"use client";

import { useState } from "react";
import { Play, Clock, Captions, Heart } from "lucide-react";
import type { VideoItem } from "@/lib/videos/types";

type Props = {
  video: VideoItem;
  onSelect: (video: VideoItem) => void;
  isFavorite?: boolean;
  onToggleFavorite?: (video: VideoItem) => void;
};

export function VideoCard({ video, onSelect, isFavorite = false, onToggleFavorite }: Props) {
  const [imgError, setImgError] = useState(false);

  const thumbUrl =
    video.thumbnailUrl ||
    (imgError
      ? `https://i.ytimg.com/vi/${video.youtubeId}/hqdefault.jpg`
      : `https://i.ytimg.com/vi/${video.youtubeId}/mqdefault.jpg`);

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
          src={thumbUrl}
          alt={video.title}
          className="video-thumb"
          loading="lazy"
          onError={() => setImgError(true)}
        />
        <div className="video-thumb-overlay">
          <div className="video-play-icon">
            <Play size={16} fill="currentColor" />
          </div>
        </div>

        {video.duration && (
          <span className="video-badge duration-badge">
            <Clock size={10} />
            <span>{video.duration}</span>
          </span>
        )}

        {video.cefrLevel && video.cefrLevel !== "all" && (
          <span className="video-badge level-badge">{video.cefrLevel}</span>
        )}

        {video.hasSubtitles && (
          <span className="video-badge captions-badge" title="Синхронный текст доступен">
            <Captions size={11} />
          </span>
        )}
        {onToggleFavorite && (
          <button
            type="button"
            className={`video-favorite-btn ${isFavorite ? "active" : ""}`}
            onClick={(event) => { event.stopPropagation(); onToggleFavorite(video); }}
            aria-label={isFavorite ? "Убрать из избранного" : "Добавить в избранное"}
            title={isFavorite ? "Убрать из избранного" : "Сохранить видео"}
          >
            <Heart size={14} fill={isFavorite ? "currentColor" : "none"} />
          </button>
        )}
      </div>

      <div className="video-card-body">
        <div className="video-card-channel">{video.channel}</div>
        <h3 className="video-card-title" title={video.title}>
          {video.title}
        </h3>
      </div>
    </article>
  );
}
