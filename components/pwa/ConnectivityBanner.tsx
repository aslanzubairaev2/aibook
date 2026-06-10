"use client";

import { useEffect, useState } from "react";
import { DATA_FRESH_EVENT, DATA_OFFLINE_EVENT, DATA_STALE_EVENT } from "@/lib/net/freshFetch";

type BannerState = "ok" | "stale" | "offline";

/**
 * Global warning that the app is showing data that is not in sync with the
 * database — either fully offline or served from the service-worker cache.
 * Driven by freshFetch events plus the browser online/offline signals.
 */
export function ConnectivityBanner() {
  const [state, setState] = useState<BannerState>("ok");

  useEffect(() => {
    const onStale = () => setState((s) => (s === "offline" ? s : "stale"));
    const onOffline = () => setState("offline");
    const onFresh = () => setState("ok");
    const onBrowserOffline = () => setState("offline");
    const onBrowserOnline = () => setState((s) => (s === "offline" ? "ok" : s));

    window.addEventListener(DATA_STALE_EVENT, onStale);
    window.addEventListener(DATA_OFFLINE_EVENT, onOffline);
    window.addEventListener(DATA_FRESH_EVENT, onFresh);
    window.addEventListener("offline", onBrowserOffline);
    window.addEventListener("online", onBrowserOnline);
    return () => {
      window.removeEventListener(DATA_STALE_EVENT, onStale);
      window.removeEventListener(DATA_OFFLINE_EVENT, onOffline);
      window.removeEventListener(DATA_FRESH_EVENT, onFresh);
      window.removeEventListener("offline", onBrowserOffline);
      window.removeEventListener("online", onBrowserOnline);
    };
  }, []);

  if (state === "ok") return null;

  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        padding: "10px 16px",
        background: "#3a2a18",
        borderBottom: "1px solid var(--accent-dim, #8a6a20)",
        color: "var(--accent-bright, #f0c060)",
        fontSize: 13,
        lineHeight: 1.4,
      }}
    >
      <span>
        {state === "offline"
          ? "Нет связи с сервером — показаны сохранённые данные, они могут быть неактуальны."
          : "Сервер не ответил — показаны данные из кэша, они могут быть неактуальны."}
      </span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        style={{
          flexShrink: 0,
          padding: "4px 12px",
          borderRadius: 999,
          border: "1px solid var(--accent-dim, #8a6a20)",
          background: "transparent",
          color: "var(--accent-bright, #f0c060)",
          fontSize: 12,
          cursor: "pointer",
        }}
      >
        Обновить
      </button>
    </div>
  );
}
