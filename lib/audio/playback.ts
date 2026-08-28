/**
 * Updates the media source only when the chapter actually changes.
 * Reassigning the same src reloads the element in browsers and resets currentTime.
 */
export function syncAudioSource(
  audio: HTMLAudioElement,
  audioUrl: string,
  playbackSpeed: number,
  previousAudioUrl: string | null
): boolean {
  audio.playbackRate = playbackSpeed;

  if (previousAudioUrl === audioUrl) return false;

  audio.src = audioUrl;
  audio.load();
  return true;
}

/**
 * True for the two `HTMLMediaElement.play()` rejections that are an expected
 * side effect of normal use, not a real failure:
 * - `AbortError`: a chapter/book change called `load()` while this play() was
 *   still pending, so the browser cancelled it — the new source is about to
 *   play instead.
 * - `NotAllowedError`: the browser's autoplay policy blocked a `play()` that
 *   wasn't triggered by a direct user gesture (e.g. a Media Session action the
 *   browser didn't treat as one, or a race on mount).
 *
 * Both are routine here and must not be surfaced as playback errors; anything
 * else (network failure, decode error) still is.
 */
export function isBenignPlaybackAbort(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "AbortError" || error.name === "NotAllowedError");
}
