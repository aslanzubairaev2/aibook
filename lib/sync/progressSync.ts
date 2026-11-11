"use client";

// Trainer progress, mirrored to the account.
//
// The Глаголы / Существительные / other-parts-of-speech trainers and the typed
// answers of the active card trainer keep their state in localStorage — that
// is what makes an answer instant and lets a drill run offline. On its own it
// also meant the state lived on exactly one device and died with its site
// data. Here each collection is one JSON document per (user, key) in
// user_progress_state.
//
// Nothing is ever simply overwritten: a write first reads the account's copy
// and merges the two entry by entry (the later answer wins, resets carry a
// timestamp), so a phone and a laptop used on the same day both keep all of
// their answers whichever of them syncs first. A key stays in the «dirty» set
// — itself in localStorage, so it survives a reload — until the server has
// confirmed the write; a failed write just waits for the next flush.

import {
  getCardSkillProgressMap, getLocalNamespace, getLocalPackProgress,
  saveCardSkillProgressMap, saveLocalPackProgress, setProgressWriteListener,
} from "@/lib/db/local";
import { sbGetProgressState, sbUpsertProgressState } from "@/lib/db/supabase";
import { mergeCardSkillProgress } from "@/lib/cards";
import { emptyModuleProgress, mergeModuleProgress, type ModuleProgress, type PackModule } from "@/lib/srs/packProgress";
import type { CardSkillState } from "@/lib/types";

export const PROGRESS_SYNCED_EVENT = "aibook:progress-synced";

const PACK_MODULES: PackModule[] = ["verbs", "nouns", "otherpos"];
const SKILL_KEY = "card_skill_progress";
const ALL_KEYS = [...PACK_MODULES.map((m) => `pack_progress:${m}`), SKILL_KEY];
const FLUSH_DELAY_MS = 3000;

function packModule(key: string): PackModule | null {
  const name = key.startsWith("pack_progress:") ? key.slice("pack_progress:".length) : "";
  return (PACK_MODULES as string[]).includes(name) ? (name as PackModule) : null;
}

function readLocal(key: string): unknown {
  const pack = packModule(key);
  return pack ? getLocalPackProgress(pack) : getCardSkillProgressMap();
}

function writeLocal(key: string, value: unknown) {
  const pack = packModule(key);
  if (pack) saveLocalPackProgress(pack, value as ModuleProgress, { silent: true });
  else saveCardSkillProgressMap(value as Record<string, CardSkillState>);
}

/** `remote` is whatever JSON the server holds; missing parts count as empty. */
export function mergeProgressDocument(key: string, local: unknown, remote: unknown): unknown {
  if (packModule(key)) {
    const r = (remote ?? {}) as Partial<ModuleProgress>;
    return mergeModuleProgress(local as ModuleProgress, { ...r, words: r.words ?? {}, packs: r.packs ?? {} });
  }
  return mergeCardSkillProgress(
    local as Record<string, CardSkillState>,
    (remote ?? {}) as Record<string, CardSkillState>,
  );
}

function emptyDocument(key: string): unknown {
  return packModule(key) ? emptyModuleProgress() : {};
}

// Key order inside merged objects follows insertion, so two equal states can
// serialise differently; compare on a canonical form.
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v);
}

// ─── Dirty set ───────────────────────────────────────────────────────────────

function dirtyStorageKey(): string {
  return `aibook:progress-dirty:${getLocalNamespace()}`;
}

function readDirty(): Set<string> {
  try {
    const raw = window.localStorage.getItem(dirtyStorageKey());
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function writeDirty(keys: Set<string>) {
  try {
    window.localStorage.setItem(dirtyStorageKey(), JSON.stringify([...keys]));
  } catch {
    // The in-flight flush still runs; only the «retry after reload» is lost.
  }
}

// ─── Sync ────────────────────────────────────────────────────────────────────

let activeUserId: string | null = null;
let timer: number | null = null;
let running: Promise<void> | null = null;
let listening = false;

function markDirty(key: string) {
  if (typeof window === "undefined") return;
  const dirty = readDirty();
  if (!dirty.has(key)) {
    dirty.add(key);
    writeDirty(dirty);
  }
  if (!activeUserId) return;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => void flushProgress(), FLUSH_DELAY_MS);
}

/**
 * Folds the account's copy of `keys` into this device, then uploads the result
 * wherever the account's copy is behind it.
 */
async function reconcile(userId: string, keys: string[]): Promise<void> {
  const rows = await sbGetProgressState(userId, keys);
  // Unreadable (offline, or the table is not there yet): keep everything
  // dirty and try again later.
  if (!rows) return;
  // The learner may have signed out, or into another account, meanwhile.
  if (activeUserId !== userId) return;
  const remoteByKey = new Map(rows.map((row) => [row.key, row.value]));
  const dirty = readDirty();

  for (const key of keys) {
    const local = readLocal(key);
    const remote = remoteByKey.get(key);
    const merged = mergeProgressDocument(key, local, remote);
    const mergedText = canonicalJson(merged);

    if (mergedText !== canonicalJson(local)) {
      writeLocal(key, merged);
      window.dispatchEvent(new CustomEvent(PROGRESS_SYNCED_EVENT, { detail: { key } }));
    }

    // Compare against the server's document run through the same merge, so a
    // difference in shape alone (a missing optional field) is not an upload.
    const remoteText = canonicalJson(mergeProgressDocument(key, emptyDocument(key), remote));
    if (mergedText === remoteText) {
      dirty.delete(key);
    } else if (await sbUpsertProgressState(userId, key, merged)) {
      dirty.delete(key);
    } else {
      dirty.add(key);
    }
  }
  writeDirty(dirty);
}

function run(userId: string, keys: string[]): Promise<void> {
  const previous = running ?? Promise.resolve();
  const next = previous
    .then(() => reconcile(userId, keys))
    .catch(() => undefined)
    .finally(() => { if (running === next) running = null; });
  running = next;
  return next;
}

/** Uploads every collection changed since the last confirmed write. */
export function flushProgress(): Promise<void> {
  if (typeof window === "undefined" || !activeUserId) return Promise.resolve();
  if (timer !== null) {
    window.clearTimeout(timer);
    timer = null;
  }
  const keys = [...readDirty()].filter((key) => ALL_KEYS.includes(key));
  return keys.length ? run(activeUserId, keys) : Promise.resolve();
}

/** Reads the account's copy of every collection — at sign-in and whenever the app comes back into view. */
export function pullProgress(): Promise<void> {
  if (typeof window === "undefined" || !activeUserId) return Promise.resolve();
  return run(activeUserId, ALL_KEYS);
}

/** Call once the signed-in user's storage namespace is active. */
export function startProgressSync(userId: string) {
  activeUserId = userId;
  setProgressWriteListener(markDirty);
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("online", () => void flushProgress());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flushProgress();
  });
}

export function stopProgressSync() {
  activeUserId = null;
  setProgressWriteListener(null);
  if (timer !== null && typeof window !== "undefined") window.clearTimeout(timer);
  timer = null;
}
