"use client";

import { useEffect } from "react";
import { X, ExternalLink } from "lucide-react";
import type { VideoItem } from "@/lib/videos/types";

type Props = {
  video: VideoItem;
  onClose: () => void;
};

export function VideoPlayerModal({ video, onClose }: Props) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const origin =
    typeof window !== "undefined" && window.location.origin
      ? encodeURIComponent(window.location.origin)
      : "";

  const embedUrl = `https://www.youtube.com/embed/${video.youtubeId}?autoplay=1&origin=${origin}&rel=0`;
  const youtubeWatchUrl = `https://www.youtube.com/watch?v=${video.youtubeId}`;

  return (
    <div
      className="video-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="video-modal-title"
    >
      <div
        className="video-modal-content"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <header className="video-modal-header">
          <div className="video-modal-title-wrap">
            <h2 id="video-modal-title" className="video-modal-title">
              {video.title}
            </h2>
            <div className="video-modal-sub">
              <span className="video-modal-channel">{video.channel}</span>
              {video.cefrLevel && video.cefrLevel !== "all" && (
                <span className="video-modal-level">{video.cefrLevel}</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="video-modal-close-btn"
            onClick={onClose}
            aria-label="Закрыть плеер"
          >
            <X size={18} />
          </button>
        </header>

        {/* Video Player */}
        <div className="video-player-container">
          <iframe
            src={embedUrl}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
            className="video-iframe"
          />
        </div>

        {/* Action Link & Description */}
        <div className="video-modal-footer">
          <a
            href={youtubeWatchUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="video-open-yt-btn"
          >
            <ExternalLink size={14} />
            <span>Открыть на YouTube</span>
          </a>
          {video.description && (
            <p className="video-modal-desc">{video.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}
