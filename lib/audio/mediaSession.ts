// Media Session API wiring for the audiobook player.
//
// This is what lets the lock screen / notification shade / hardware media
// keys control playback while the tab is hidden or the phone screen is off —
// the actual mechanism background playback depends on on mobile browsers.
// None of it is required for the `<audio>` element itself to keep playing in
// a backgrounded tab (that already works as long as nothing pauses it on
// `visibilitychange`, which this app's player does not do); it is what turns
// "audio keeps playing" into "the user can control it without looking at the
// app". Every call is a no-op where the API is unavailable, so this is safe
// to call unconditionally from any browser.

export type MediaSessionActions = {
  play: () => void;
  pause: () => void;
  seekBackward: () => void;
  seekForward: () => void;
  previousTrack: () => void;
  nextTrack: () => void;
  /** Omit to leave the lock-screen scrubber non-interactive. */
  seekTo?: (seconds: number) => void;
};

export type MediaSessionMetadataInput = {
  title: string;
  artist?: string;
  album?: string;
  /** Cover image URL; only used if the browser can build a MediaMetadata artwork entry from it. */
  artworkUrl?: string | null;
};

export function isMediaSessionSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

/** Sets what the lock screen / notification shows for the current chapter. */
export function setMediaSessionMetadata(meta: MediaSessionMetadataInput): void {
  if (!isMediaSessionSupported()) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: meta.title,
      artist: meta.artist,
      album: meta.album,
      artwork: meta.artworkUrl ? [{ src: meta.artworkUrl, sizes: "512x512", type: "image/jpeg" }] : undefined,
    });
  } catch {
    // Some engines (older Firefox) lack the MediaMetadata constructor.
  }
}

const ALL_ACTIONS: MediaSessionAction[] = [
  "play",
  "pause",
  "seekbackward",
  "seekforward",
  "previoustrack",
  "nexttrack",
  "seekto",
];

/**
 * Registers system media-key handlers that call straight into the player's
 * own play/pause/seek/chapter controller — no separate playback logic here,
 * per the task's "не дублируя логику контроллера" requirement.
 *
 * Returns a cleanup function that unregisters every handler; call it on
 * unmount or before re-registering with new callbacks.
 */
export function setMediaSessionActionHandlers(actions: MediaSessionActions): () => void {
  if (!isMediaSessionSupported()) return () => {};

  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => actions.play(),
    pause: () => actions.pause(),
    seekbackward: () => actions.seekBackward(),
    seekforward: () => actions.seekForward(),
    previoustrack: () => actions.previousTrack(),
    nexttrack: () => actions.nextTrack(),
  };
  if (actions.seekTo) {
    handlers.seekto = (details) => actions.seekTo?.(details.seekTime ?? 0);
  }

  for (const action of ALL_ACTIONS) {
    try {
      navigator.mediaSession.setActionHandler(action, handlers[action] ?? null);
    } catch {
      // Not every browser supports every action (e.g. Safari lacks "seekto").
    }
  }

  return () => {
    for (const action of ALL_ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
  };
}

export function setMediaSessionPlaybackState(state: "playing" | "paused" | "none"): void {
  if (!isMediaSessionSupported()) return;
  try {
    navigator.mediaSession.playbackState = state;
  } catch {
    // ignore
  }
}

/** Keeps the lock-screen scrubber's position in sync, where the browser supports it. */
export function setMediaSessionPositionState(state: { duration: number; position: number; playbackRate: number }): void {
  if (!isMediaSessionSupported() || typeof navigator.mediaSession.setPositionState !== "function") return;
  try {
    // A malformed state (NaN/negative/position beyond duration) throws
    // instead of no-op'ing — routine during a chapter change's brief window
    // before `duration` catches up with `position`.
    if (!Number.isFinite(state.duration) || state.duration <= 0) return;
    if (!Number.isFinite(state.position) || state.position < 0 || state.position > state.duration) return;
    navigator.mediaSession.setPositionState(state);
  } catch {
    // ignore
  }
}
