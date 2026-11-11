"use client";

// Every screen but home, loaded when it is first needed.
//
// app/page.tsx used to import all of them statically, so the first paint of
// the home screen waited for the reader, the card trainer, the catalogue, the
// voice chat and every drill to be downloaded and parsed — code for sixteen
// screens to show one. Each is now its own chunk. preloadScreens() fetches
// them in the background once the app is up, so in practice a tab still opens
// at once; only the very first paint got cheaper.

import dynamic from "next/dynamic";

function ScreenLoading() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "60svh" }}>
      <div className="auth-spinner-wrap">
        <div className="auth-spinner-ring" />
      </div>
    </div>
  );
}

const loaders = {
  auth: () => import("@/components/auth/AuthScreen"),
  cards: () => import("@/components/cards/CardsView"),
  dictionary: () => import("@/components/dictionary/DictionaryView"),
  discover: () => import("@/components/discover/DiscoverView"),
  grammar: () => import("@/components/grammar/GrammarView"),
  homework: () => import("@/components/homework/HomeworkView"),
  library: () => import("@/components/library/LibraryView"),
  liveChat: () => import("@/components/livechat/LiveChatModal"),
  liveTranslate: () => import("@/components/live-translate/LiveTranslateView"),
  nouns: () => import("@/components/nouns/NounsView"),
  otherPos: () => import("@/components/otherpos/OtherPosView"),
  practice: () => import("@/components/practice/PracticeView"),
  pronouns: () => import("@/components/pronouns/PronounsView"),
  reader: () => import("@/components/reader/ReaderView"),
  settings: () => import("@/components/settings/SettingsView"),
  verbs: () => import("@/components/verbs/VerbsView"),
};

export const AuthScreen = dynamic(() => loaders.auth().then((m) => m.AuthScreen), { ssr: false, loading: ScreenLoading });
export const CardsView = dynamic(() => loaders.cards().then((m) => m.CardsView), { ssr: false, loading: ScreenLoading });
export const DictionaryView = dynamic(() => loaders.dictionary().then((m) => m.DictionaryView), { ssr: false, loading: ScreenLoading });
export const DiscoverView = dynamic(() => loaders.discover().then((m) => m.DiscoverView), { ssr: false, loading: ScreenLoading });
export const GrammarView = dynamic(() => loaders.grammar().then((m) => m.GrammarView), { ssr: false, loading: ScreenLoading });
export const HomeworkView = dynamic(() => loaders.homework().then((m) => m.HomeworkView), { ssr: false, loading: ScreenLoading });
export const LibraryView = dynamic(() => loaders.library().then((m) => m.LibraryView), { ssr: false, loading: ScreenLoading });
// A modal: nothing to show while it loads.
export const LiveChatModal = dynamic(() => loaders.liveChat().then((m) => m.LiveChatModal), { ssr: false });
export const LiveTranslateView = dynamic(() => loaders.liveTranslate().then((m) => m.LiveTranslateView), { ssr: false, loading: ScreenLoading });
export const NounsView = dynamic(() => loaders.nouns().then((m) => m.NounsView), { ssr: false, loading: ScreenLoading });
export const OtherPosView = dynamic(() => loaders.otherPos().then((m) => m.OtherPosView), { ssr: false, loading: ScreenLoading });
export const PracticeView = dynamic(() => loaders.practice().then((m) => m.PracticeView), { ssr: false, loading: ScreenLoading });
export const PronounsView = dynamic(() => loaders.pronouns().then((m) => m.PronounsView), { ssr: false, loading: ScreenLoading });
export const ReaderView = dynamic(() => loaders.reader().then((m) => m.ReaderView), { ssr: false, loading: ScreenLoading });
export const SettingsView = dynamic(() => loaders.settings().then((m) => m.SettingsView), { ssr: false, loading: ScreenLoading });
export const VerbsView = dynamic(() => loaders.verbs().then((m) => m.VerbsView), { ssr: false, loading: ScreenLoading });

/**
 * Fetches every screen's code in the background. Returns a cancel function for
 * an effect's cleanup. Skipped on a metered or slow connection, where the
 * screens the learner never opens would be bytes spent for nothing.
 */
export function preloadScreens(): () => void {
  if (typeof window === "undefined") return () => undefined;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  if (connection?.saveData || /(^|-)2g$/.test(connection?.effectiveType ?? "")) return () => undefined;

  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    for (const load of Object.values(loaders)) void load().catch(() => undefined);
  };
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }).requestIdleCallback;
  const timer = idle ? idle(run, { timeout: 4000 }) : window.setTimeout(run, 1500);
  return () => {
    cancelled = true;
    if (!idle) window.clearTimeout(timer);
  };
}
