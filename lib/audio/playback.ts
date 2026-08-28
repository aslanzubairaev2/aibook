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
