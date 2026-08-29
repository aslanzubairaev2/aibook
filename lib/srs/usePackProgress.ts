"use client";

import { useCallback, useRef, useState } from "react";
import { getLocalPackProgress, saveLocalPackProgress } from "@/lib/db/local";
import { recordAnswer, recordSession, resetWords, type ModuleProgress, type PackModule } from "@/lib/srs/packProgress";

/**
 * The pack-coverage state for one trainer module, read once and written
 * through on every answer.
 *
 * Both trainers (Глаголы, Существительные) keep exactly the same bookkeeping,
 * so it lives here rather than being written twice: which words this session
 * has already answered (so a second drill on the same word can only downgrade
 * it, never re-open it), and the save on every change.
 */
export function usePackProgress(module: PackModule) {
  const [progress, setProgress] = useState<ModuleProgress>(() => getLocalPackProgress(module));
  const seenRef = useRef<Set<string>>(new Set());

  /** A session is starting on this pack — stamps it and clears the per-session set. */
  const startSession = useCallback((packKey: string) => {
    seenRef.current = new Set();
    setProgress((prev) => {
      const next = recordSession(prev, packKey, Date.now());
      saveLocalPackProgress(module, next);
      return next;
    });
  }, [module]);

  const record = useCallback((entryId: string, correct: boolean) => {
    const first = !seenRef.current.has(entryId);
    seenRef.current.add(entryId);
    setProgress((prev) => {
      const next = recordAnswer(prev, entryId, correct, first, Date.now());
      saveLocalPackProgress(module, next);
      return next;
    });
  }, [module]);

  const reset = useCallback((entryIds: string[], packKey?: string) => {
    setProgress((prev) => {
      const next = resetWords(prev, entryIds, packKey);
      saveLocalPackProgress(module, next);
      return next;
    });
  }, [module]);

  return { progress, startSession, record, reset };
}
