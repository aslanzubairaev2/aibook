"use client";

// A test from the teacher agent, taken in the app: block by block, with the
// reading text or the recording next to its questions, autosaved answers, and
// a confirmation before anything final.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Lock } from "lucide-react";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { useAuth } from "@/lib/auth/useAuth";
import { AssessmentItem } from "./AssessmentItem";
import { ListeningPlayer } from "./ListeningPlayer";
import { TappableText, WordToolsProvider } from "./WordTools";
import {
  DIMENSION_NAMES,
  SKILL_NAMES,
  assessmentApi,
  isEmptyAnswer,
  type AnswerValue,
  type View,
  type ViewSection,
  type ViewWordMark,
} from "./types";

type Confirm = { kind: "section"; section: ViewSection } | { kind: "submit" } | null;

export function AssessmentScreen({ id }: { id: string }) {
  const { user, isLoading } = useAuth();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // Keyed on the user id, not the user object: a token refresh hands out a new
  // object and must not reopen the test under the learner's fingers.
  const userId = user?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { view: fresh } = await assessmentApi(id, { action: "open" });
        if (cancelled) return;
        setView(fresh);
        setActiveId((current) => current ?? fresh.current_section_id ?? fresh.sections[0]?.id ?? null);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Не удалось открыть тест.");
      }
    })();
    return () => { cancelled = true; };
  }, [userId, id]);

  const run = useCallback(async (body: Record<string, unknown>) => {
    setNotice(null);
    try {
      const { view: fresh } = await assessmentApi(id, body);
      setView(fresh);
      return fresh;
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Не получилось.");
      return null;
    }
  }, [id]);

  const onDraft = useCallback((itemId: string, value: AnswerValue) => {
    // Autosave is quiet: a failure here must not interrupt typing.
    void assessmentApi(id, { action: "draft", item_id: itemId, value }).catch(() => {});
  }, [id]);
  const onAnswer = useCallback(async (itemId: string, value: AnswerValue) => { await run({ action: "answer", item_id: itemId, value }); }, [run]);
  const onDontKnow = useCallback(async (itemId: string) => { await run({ action: "dont_know", item_id: itemId }); }, [run]);

  // Word marks are applied locally at once, then saved; the reply carries the truth.
  const [localMarks, setLocalMarks] = useState<Record<string, ViewWordMark>>({});
  const marks = useMemo(() => {
    const map = new Map<string, ViewWordMark>((view?.word_marks ?? []).map((m) => [m.key, m]));
    for (const [key, m] of Object.entries(localMarks)) map.set(key, { ...map.get(key), ...m });
    return map;
  }, [view?.word_marks, localMarks]);
  const markWord = useCallback(async (sectionId: string, itemId: string | null, word: string, context: string, patch: { unknown?: boolean; translation?: string }) => {
    const key = `${sectionId}|${itemId ?? ""}|${word.toLocaleLowerCase()}`;
    setLocalMarks((current) => {
      const previous = current[key] ?? { key, word, section_id: sectionId, item_id: itemId, unknown: false, translation: null };
      return { ...current, [key]: { ...previous, ...(patch.unknown !== undefined ? { unknown: patch.unknown } : {}), ...(patch.translation ? { translation: patch.translation } : {}) } };
    });
    try {
      const { view: fresh } = await assessmentApi(id, { action: "word_mark", section_id: sectionId, item_id: itemId, word, context, ...patch });
      setView(fresh);
    } catch { /* the local mark stays; it is retried with the next one */ }
  }, [id]);

  const active = useMemo(() => view?.sections.find((s) => s.id === activeId) ?? view?.sections[0] ?? null, [view, activeId]);
  const closed = view ? view.attempt.status !== "in_progress" : false;
  const totalItems = view?.sections.reduce((n, s) => n + s.item_count, 0) ?? 0;
  const answeredItems = view?.sections.reduce((n, s) => n + s.answered, 0) ?? 0;

  if (isLoading) return <main className="asm-screen"><p className="asm-muted">Загрузка…</p></main>;
  if (!user) return <AuthScreen />;
  if (error) {
    return (
      <main className="asm-screen">
        <Link href="/" className="asm-back"><ArrowLeft size={18} /> AIBook</Link>
        <p className="asm-status is-wrong">{error}</p>
      </main>
    );
  }
  if (!view || !active) return <main className="asm-screen"><p className="asm-muted">Открываем тест…</p></main>;

  const sectionIndex = view.sections.findIndex((s) => s.id === active.id);
  const nextSection = view.sections[sectionIndex + 1];
  const unansweredAll = view.sections.flatMap((s) => (s.questions_locked ? [] : s.items)
    .map((item, i) => ({ s, item, i }))
    .filter(({ item }) => {
      if (item.answer.status === "dont_know") return false;
      if (item.recordings_used !== undefined) return !(item.last_recording?.status === "done" || (item.recordings_used ?? 0) > 0);
      // A draft counts: finishing the block turns it into the answer.
      return item.answer.value === null && (item.answer.draft === null || isEmptyAnswer(item.answer.draft));
    }));
  const unansweredHere = active.questions_locked ? active.item_count : unansweredAll.filter(({ s }) => s.id === active.id).length;

  const completeSection = async (section: ViewSection) => {
    setBusy(true);
    const fresh = await run({ action: "complete_section", section_id: section.id });
    setBusy(false);
    setConfirm(null);
    if (fresh) {
      const next = fresh.sections.find((s) => !s.completed && s.available);
      if (next) setActiveId(next.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const submit = async () => {
    setBusy(true);
    await run({ action: "submit" });
    setBusy(false);
    setConfirm(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const allOthersDone = view.sections.every((s) => s.id === active.id || s.completed);

  const checkMode = view.assessment.mode === "learning" && view.assessment.results_release === "immediate";
  const wordTools = { enabled: view.assessment.allow_word_lookup, language: view.assessment.language, marks, mark: markWord };

  return (
    <WordToolsProvider value={wordTools}>
    <main className="asm-screen">
      <header className="asm-header">
        <Link href="/" className="asm-back" aria-label="На главную"><ArrowLeft size={18} /></Link>
        <div className="asm-header-text">
          <h1>{view.assessment.title}</h1>
          <span className="asm-muted asm-small">
            {view.assessment.mode === "diagnostic" ? "Диагностика" : "Обучение"} · отвечено {answeredItems} из {totalItems}
          </span>
        </div>
      </header>

      <nav className="asm-blocks" aria-label="Блоки теста">
        {view.sections.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`asm-block${s.id === active.id ? " is-active" : ""}${s.completed ? " is-done" : ""}`}
            disabled={!s.available}
            onClick={() => { setActiveId(s.id); window.scrollTo({ top: 0 }); }}
          >
            <span className="asm-block-num">{s.completed ? <Check size={13} /> : !s.available ? <Lock size={12} /> : i + 1}</span>
            <span>{s.title}</span>
            <span className="asm-muted">{s.answered}/{s.item_count}</span>
          </button>
        ))}
      </nav>

      {closed && <Results view={view} />}

      <section className={`asm-section${active.stimulus?.type === "text" ? " has-text" : ""}`}>
        <div className="asm-section-head">
          <h2>{active.title} <span className="asm-muted asm-small">· {SKILL_NAMES[active.skill]}</span></h2>
          {active.instructions && <p className="asm-instructions">{active.instructions}</p>}
        </div>

        {active.stimulus?.type === "text" && (
          <details className="asm-reading" open>
            <summary>{active.stimulus.title || "Текст"}</summary>
            {active.stimulus.paragraphs.map((p, i) => <p key={i}><TappableText text={p} sectionId={active.id} /></p>)}
            {active.stimulus.translation.length > 0 && (
              <details className="asm-translation">
                <summary>Перевод</summary>
                {active.stimulus.translation.map((p, i) => <p key={i}>{p}</p>)}
              </details>
            )}
          </details>
        )}

        <div className="asm-questions">
          {active.stimulus?.type === "audio" && (
            <ListeningPlayer
              key={active.id}
              assessmentId={id}
              sectionId={active.id}
              stimulus={active.stimulus}
              closed={closed || active.completed}
              onView={setView}
            />
          )}

          {active.questions_locked
            ? <p className="asm-status">Вопросы откроются после начала первого прослушивания.</p>
            : active.items.map((item, i) => (
                <AssessmentItem
                  key={`${view.attempt.id}:${item.id}`}
                  assessmentId={id}
                  sectionId={active.id}
                  item={item}
                  index={i}
                  mode={view.assessment.mode}
                  checkMode={checkMode}
                  language={view.assessment.language}
                  onView={setView}
                  disabled={closed || active.completed}
                  onDraft={onDraft}
                  onAnswer={onAnswer}
                  onDontKnow={onDontKnow}
                />
              ))}

          {notice && <p className="asm-status is-wrong">{notice}</p>}

          {!closed && (
            <div className="asm-section-actions">
              {!active.completed && !(allOthersDone && !nextSection) && (
                <button type="button" className="asm-btn asm-btn-primary" disabled={busy} onClick={() => setConfirm({ kind: "section", section: active })}>
                  Завершить блок
                </button>
              )}
              {active.completed && nextSection?.available && (
                <button type="button" className="asm-btn asm-btn-primary" onClick={() => { setActiveId(nextSection.id); window.scrollTo({ top: 0 }); }}>
                  Следующий блок
                </button>
              )}
              {(allOthersDone || view.assessment.section_order === "free") && (
                <button type="button" className={`asm-btn${allOthersDone ? " asm-btn-primary" : ""}`} disabled={busy} onClick={() => setConfirm({ kind: "submit" })}>
                  Сдать тест
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {confirm && (
        <div className="asm-modal-backdrop" role="dialog" aria-modal="true">
          <div className="asm-modal">
            {confirm.kind === "section" ? (
              <>
                <h3>Завершить блок «{confirm.section.title}»?</h3>
                <p>
                  {unansweredHere > 0
                    ? `Без ответа: ${unansweredHere} из ${confirm.section.item_count}. Они будут засчитаны как пропущенные.`
                    : "Все задания блока отвечены."}
                </p>
                <p className="asm-muted">После завершения ответы в этом блоке изменить нельзя.</p>
                <div className="asm-section-actions">
                  <button type="button" className="asm-btn" onClick={() => setConfirm(null)}>Вернуться</button>
                  <button type="button" className="asm-btn asm-btn-primary" disabled={busy} onClick={() => completeSection(confirm.section)}>Завершить</button>
                </div>
              </>
            ) : (
              <>
                <h3>Сдать тест?</h3>
                {unansweredAll.length > 0 ? (
                  <>
                    <p>Без ответа: {unansweredAll.length}.</p>
                    <ul className="asm-missing">
                      {unansweredAll.slice(0, 12).map(({ s, i, item }) => (
                        <li key={item.id}>
                          <button type="button" className="asm-link-btn" onClick={() => { setConfirm(null); setActiveId(s.id); window.setTimeout(() => document.getElementById(`item-${item.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50); }}>
                            {s.title}, задание {i + 1}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : <p>Все задания отвечены.</p>}
                <p className="asm-muted">После сдачи ответы изменить нельзя.</p>
                <div className="asm-section-actions">
                  <button type="button" className="asm-btn" onClick={() => setConfirm(null)}>Вернуться</button>
                  <button type="button" className="asm-btn asm-btn-primary" disabled={busy} onClick={submit}>Сдать</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </main>
    </WordToolsProvider>
  );
}

function Results({ view }: { view: View }) {
  if (!view.results) {
    return (
      <div className="asm-results">
        <strong>Тест сдан.</strong>
        <p className="asm-muted">
          {view.awaiting_review
            ? "Преподаватель проверит письменные ответы — результаты появятся здесь после проверки."
            : "Результаты появятся здесь."}
        </p>
      </div>
    );
  }
  const r = view.results;
  const dims = Object.entries(r.dimensions).filter(([, d]) => d.errors + d.minor > 0);
  return (
    <div className="asm-results">
      <div className="asm-results-total">
        <strong>{r.totals.score} из {r.totals.max}</strong>
        {r.totals.percent !== null && <span>{r.totals.percent}%</span>}
        {r.totals.pending_review > 0 && <span className="asm-muted">ждёт проверки: {r.totals.pending_review}</span>}
      </div>
      {r.totals.skipped_points > 0 && (
        <p className="asm-muted asm-small">
          {r.totals.skipped_points} б. из {r.totals.max} — пропущенные задания{r.totals.percent_of_attempted !== null ? `; по выполненным заданиям — ${r.totals.percent_of_attempted}%` : ""}.
        </p>
      )}
      {r.totals.technical_issues > 0 && <p className="asm-muted asm-small">Не оценено по техническим причинам: {r.totals.technical_issues} (не влияет на баллы).</p>}
      <ul className="asm-skill-rows">
        {r.skills.map((s) => (
          <li key={s.skill}>
            <span>{SKILL_NAMES[s.skill]}</span>
            {s.state === "not_done"
              ? <span className="asm-muted asm-small">не выполнено</span>
              : <span className="asm-progress"><span style={{ width: `${s.percent ?? 0}%` }} /></span>}
            <span>
              {s.state === "not_done" ? "" : s.percent === null ? "ждёт" : `${s.percent}%`}
              {s.state !== "not_done" && s.skipped > 0 && <span className="asm-muted asm-small"> · пропущено {s.skipped}</span>}
            </span>
          </li>
        ))}
      </ul>
      {dims.length > 0 && (
        <p className="asm-muted asm-small">
          Ошибки: {dims.map(([d, v]) => `${DIMENSION_NAMES[d] ?? d} — ${v.errors + v.minor}`).join(" · ")}
        </p>
      )}
      {r.summary && <p className="asm-teacher">{r.summary}</p>}
      {r.gaps.length > 0 && (
        <ul className="asm-gaps">
          {r.gaps.map((g, i) => <li key={i}><strong>{g.topic}</strong>{g.description ? ` — ${g.description}` : ""}</li>)}
        </ul>
      )}
    </div>
  );
}
