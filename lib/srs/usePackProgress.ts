"use client";

import { useCallback, useRef, useState } from "react";
import { getLocalPackProgress, saveLocalPackProgress } from "@/lib/db/local";
import { drillId, recordDrillAnswer, type DrillKey } from "@/lib/srs/drillSchedule";
import { markWordCompleted, recordAnswer, recordSession, resetAllProgress, resetWords, type ModuleProgress, type PackModule } from "@/lib/srs/packProgress";

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
  const drillSeenRef = useRef<Set<string>>(new Set());

  /** A session is starting on this pack — stamps it and clears the per-session set. */
  const startSession = useCallback((packKey: string) => {
    seenRef.current = new Set();
    drillSeenRef.current = new Set();
    setProgress((prev) => {
      const next = recordSession(prev, packKey, Date.now());
      saveLocalPackProgress(module, next);
      return next;
    });
  }, [module]);

  /** A resumed session: these words were already answered in it before the page closed. */
  const markSeen = useCallback((entryIds: string[]) => {
    for (const id of entryIds) seenRef.current.add(id);
  }, []);

  const record = useCallback((entryId: string, correct: boolean) => {
    const first = !seenRef.current.has(entryId);
    seenRef.current.add(entryId);
    setProgress((prev) => {
      const next = recordAnswer(prev, entryId, correct, first, Date.now());
      saveLocalPackProgress(module, next);
      return next;
    });
  }, [module]);

  /** One graded drill of a word (Глаголы): moves that drill's own schedule, not the word's. */
  const recordDrill = useCallback((entryId: string, drill: DrillKey, correct: boolean) => {
    const id = drillId(entryId, drill);
    const first = !drillSeenRef.current.has(id);
    drillSeenRef.current.add(id);
    setProgress((prev) => {
      const next = recordDrillAnswer(prev, entryId, drill, correct, first, Date.now());
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

  const completeWord = useCallback((entryId: string) => {
    setProgress((prev) => {
      const next = markWordCompleted(prev, entryId, Date.now());
      saveLocalPackProgress(module, next);
      return next;
    });
  }, [module]);

  const resetAll = useCallback(() => {
    setProgress(() => {
      const next = resetAllProgress();
      saveLocalPackProgress(module, next);
      return next;
    });
  }, [module]);

  return { progress, startSession, markSeen, record, recordDrill, completeWord, reset, resetAll };
}
