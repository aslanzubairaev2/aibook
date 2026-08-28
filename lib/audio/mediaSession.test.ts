import test from "node:test";
import assert from "node:assert/strict";
import {
  isMediaSessionSupported,
  setMediaSessionActionHandlers,
  setMediaSessionMetadata,
  setMediaSessionPlaybackState,
  setMediaSessionPositionState,
} from "./mediaSession.ts";

type ActionHandler = ((details?: { seekTime?: number }) => void) | null;

class FakeMediaSession {
  metadata: unknown = null;
  playbackState = "none";
  handlers = new Map<string, ActionHandler>();
  positionState: unknown = null;

  setActionHandler(action: string, handler: ActionHandler) {
    this.handlers.set(action, handler);
  }

  setPositionState(state: unknown) {
    this.positionState = state;
  }
}

class FakeMediaMetadata {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: unknown;
  constructor(init: { title?: string; artist?: string; album?: string; artwork?: unknown }) {
    Object.assign(this, init);
  }
}

/** Installs a fake `navigator.mediaSession` (and `MediaMetadata`) for the duration of `run`, then restores whatever was there before. */
function withFakeMediaSession<T>(run: (session: FakeMediaSession) => T): T {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const originalMediaMetadata = Object.getOwnPropertyDescriptor(globalThis, "MediaMetadata");

  const session = new FakeMediaSession();
  Object.defineProperty(globalThis, "navigator", {
    value: { mediaSession: session },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, "MediaMetadata", {
    value: FakeMediaMetadata,
    configurable: true,
    writable: true,
  });

  try {
    return run(session);
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
    if (originalMediaMetadata) Object.defineProperty(globalThis, "MediaMetadata", originalMediaMetadata);
    else delete (globalThis as { MediaMetadata?: unknown }).MediaMetadata;
  }
}

/** Installs a `navigator` with no `mediaSession` at all — the unsupported-browser case. */
function withoutMediaSession<T>(run: () => T): T {
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: {},
    configurable: true,
    writable: true,
  });
  try {
    return run();
  } finally {
    if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
  }
}

test("isMediaSessionSupported reflects whether the API is present", () => {
  withoutMediaSession(() => {
    assert.equal(isMediaSessionSupported(), false);
  });
  withFakeMediaSession(() => {
    assert.equal(isMediaSessionSupported(), true);
  });
});

test("every call is a safe no-op when Media Session isn't supported", () => {
  withoutMediaSession(() => {
    assert.doesNotThrow(() => setMediaSessionMetadata({ title: "x" }));
    assert.doesNotThrow(() => setMediaSessionPlaybackState("playing"));
    assert.doesNotThrow(() => setMediaSessionPositionState({ duration: 10, position: 1, playbackRate: 1 }));
    const cleanup = setMediaSessionActionHandlers({
      play: () => {}, pause: () => {}, seekBackward: () => {}, seekForward: () => {},
      previousTrack: () => {}, nextTrack: () => {},
    });
    assert.doesNotThrow(cleanup);
  });
});

test("setMediaSessionMetadata builds a MediaMetadata from the chapter's title, book's author and cover", () => {
  withFakeMediaSession((session) => {
    setMediaSessionMetadata({ title: "Kapitel 3", artist: "Franz Kafka", album: "Die Verwandlung", artworkUrl: "https://example.com/cover.jpg" });
    const meta = session.metadata as FakeMediaMetadata;
    assert.equal(meta.title, "Kapitel 3");
    assert.equal(meta.artist, "Franz Kafka");
    assert.equal(meta.album, "Die Verwandlung");
    assert.deepEqual(meta.artwork, [{ src: "https://example.com/cover.jpg", sizes: "512x512", type: "image/jpeg" }]);
  });
});

test("setMediaSessionMetadata omits artwork when there is no cover, without throwing", () => {
  withFakeMediaSession((session) => {
    setMediaSessionMetadata({ title: "Kapitel 1" });
    const meta = session.metadata as FakeMediaMetadata;
    assert.equal(meta.artwork, undefined);
  });
});

test("setMediaSessionActionHandlers wires every system media key to the player's own controller — no separate logic", () => {
  withFakeMediaSession((session) => {
    const calls: string[] = [];
    let seekToArg: number | undefined;
    const cleanup = setMediaSessionActionHandlers({
      play: () => calls.push("play"),
      pause: () => calls.push("pause"),
      seekBackward: () => calls.push("seekBackward"),
      seekForward: () => calls.push("seekForward"),
      previousTrack: () => calls.push("previousTrack"),
      nextTrack: () => calls.push("nextTrack"),
      seekTo: (seconds) => { seekToArg = seconds; },
    });

    session.handlers.get("play")?.();
    session.handlers.get("pause")?.();
    session.handlers.get("seekbackward")?.();
    session.handlers.get("seekforward")?.();
    session.handlers.get("previoustrack")?.();
    session.handlers.get("nexttrack")?.();
    session.handlers.get("seekto")?.({ seekTime: 42 });

    assert.deepEqual(calls, ["play", "pause", "seekBackward", "seekForward", "previousTrack", "nextTrack"]);
    assert.equal(seekToArg, 42);

    cleanup();
    for (const action of ["play", "pause", "seekbackward", "seekforward", "previoustrack", "nexttrack", "seekto"]) {
      assert.equal(session.handlers.get(action), null, `${action} handler should be cleared on cleanup`);
    }
  });
});

test("seekto is left unregistered (null) when the caller has no scrubber to seek", () => {
  withFakeMediaSession((session) => {
    setMediaSessionActionHandlers({
      play: () => {}, pause: () => {}, seekBackward: () => {}, seekForward: () => {},
      previousTrack: () => {}, nextTrack: () => {},
    });
    assert.equal(session.handlers.get("seekto"), null);
  });
});

test("setMediaSessionPlaybackState forwards the state directly", () => {
  withFakeMediaSession((session) => {
    setMediaSessionPlaybackState("playing");
    assert.equal(session.playbackState, "playing");
    setMediaSessionPlaybackState("paused");
    assert.equal(session.playbackState, "paused");
  });
});

test("setMediaSessionPositionState accepts a valid position", () => {
  withFakeMediaSession((session) => {
    setMediaSessionPositionState({ duration: 100, position: 42, playbackRate: 1.25 });
    assert.deepEqual(session.positionState, { duration: 100, position: 42, playbackRate: 1.25 });
  });
});

test("setMediaSessionPositionState ignores a malformed state instead of throwing — routine right after a chapter change", () => {
  withFakeMediaSession((session) => {
    // Duration hasn't caught up with position yet.
    setMediaSessionPositionState({ duration: 0, position: 5, playbackRate: 1 });
    assert.equal(session.positionState, null);
    setMediaSessionPositionState({ duration: 100, position: 150, playbackRate: 1 });
    assert.equal(session.positionState, null);
    setMediaSessionPositionState({ duration: NaN, position: 0, playbackRate: 1 });
    assert.equal(session.positionState, null);
  });
});
