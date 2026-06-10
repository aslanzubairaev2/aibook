"use client";

import { useEffect } from "react";

/**
 * In development the PWA is disabled (next.config.ts), but a service worker
 * registered by a previous production build stays in the browser and keeps
 * intercepting requests. With the dev server it serves stale precached chunks
 * and day-old API responses, which looks like "Failed to fetch" / broken UI.
 * Unregister it and drop its caches so dev always talks to the live server.
 */
export function DevSwCleanup() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      if (registrations.length === 0) return;
      await Promise.all(registrations.map((r) => r.unregister()));
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      console.info("[dev] Unregistered stale service worker(s) and cleared caches. Reloading…");
      window.location.reload();
    });
  }, []);
  return null;
}
