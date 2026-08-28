// Keeping the screen (and therefore the tab) alive during a live session.
//
// A browser tab is not a background service: when the phone screen locks, the
// OS suspends the tab's timers, and Chrome on Android eventually suspends the
// AudioContext too — the microphone stream goes silent and the translation
// simply stops. iOS Safari drops `getUserMedia` outright. There is no web API
// that fixes that; the Screen Wake Lock API is the closest thing — it asks the
// OS not to lock the screen at all, so the tab is never suspended.
//
// The lock is also lost every time the tab is hidden (switching apps, an
// incoming call), and the platform never restores it on its own — hence the
// visibilitychange listener that re-acquires it when the user comes back.

type WakeLockSentinelLike = { release: () => Promise<void>; addEventListener?: (type: "release", listener: () => void) => void };
type WakeLockNavigator = Navigator & { wakeLock?: { request: (type: "screen") => Promise<WakeLockSentinelLike> } };

export type ScreenAwakeHandle = { release: () => void; isSupported: boolean };

export function isWakeLockSupported(): boolean {
  return typeof navigator !== "undefined" && "wakeLock" in (navigator as WakeLockNavigator);
}

/**
 * Requests a screen wake lock and holds it until the returned handle is released.
 *
 * Safe to call in browsers without the API — the handle then reports
 * `isSupported: false` so callers can warn instead of silently doing nothing.
 */
export function keepScreenAwake(): ScreenAwakeHandle {
  const supported = isWakeLockSupported();
  if (!supported) return { release: () => undefined, isSupported: false };

  let sentinel: WakeLockSentinelLike | null = null;
  let released = false;

  const acquire = async () => {
    if (released || sentinel) return;
    try {
      const next = await (navigator as WakeLockNavigator).wakeLock!.request("screen");
      // Losing the race with `release()` would leave an orphan lock held forever.
      if (released) { void next.release().catch(() => undefined); return; }
      sentinel = next;
      next.addEventListener?.("release", () => { sentinel = null; });
    } catch {
      // Denied (low battery, unsupported surface) — nothing to recover from.
    }
  };

  const onVisibility = () => { if (document.visibilityState === "visible") void acquire(); };
  document.addEventListener("visibilitychange", onVisibility);
  void acquire();

  return {
    isSupported: true,
    release: () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => undefined);
      sentinel = null;
    },
  };
}
