"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, BarChart3, ChevronRight, Play, Settings2, UserCheck } from "lucide-react";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { CONSTRUCTIONS, CONSTRUCTION_LABEL, MODE_LABEL, PRONOUNS, PRONOUN_IDS, RESPONSE_MODES, VERBS, verbUsable, type Construction, type ResponseMode } from "@/lib/pronouns/catalog";
import { COMPONENT_LABEL, type Component } from "@/lib/pronouns/check";
import { DEFAULT_CONFIG, FOCUSES, sessionFromConfig, type Focus, type PronounConfig, type SessionSettings } from "@/lib/pronouns/config";
import { labelDifficulty, type pronounSummary } from "@/lib/pronouns/stats";
import { verbLabel } from "@/lib/pronouns/tasks";
import { PronounDrill } from "./PronounDrill";

type Assigned = { session_id: string; status: string; settings: SessionSettings; created_at: string };
type Stats = ReturnType<typeof pronounSummary>;
type View = "home" | "settings" | "stats" | { drill: SessionSettings; assignedId: string | null; title: string };

const FOCUS_LABEL: Record<Focus, string> = {
  object_pronouns: "Местоимение-дополнение",
  subject_pronouns: "Местоимение-подлежащее",
  role_distinction: "Кто действует / на кого",
};

async function api(path: string, init?: RequestInit) {
  const headers = await sbAuthHeaders();
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...headers, ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

export function describeSettings(s: SessionSettings): string {
  const parts = [
    `${s.item_count} заданий`,
    s.verbs.map(verbLabel).join(", "),
    s.constructions.map((c) => CONSTRUCTION_LABEL[c].toLowerCase()).join(", "),
  ];
  if (s.target_pronouns.length) parts.push(`фокус: ${s.target_pronouns.map((p) => (s.focus.includes("subject_pronouns") && !s.focus.includes("object_pronouns") ? PRONOUNS[p].nom : PRONOUNS[p].acc)).join(" / ")}`);
  if (s.response_mode !== "mixed") parts.push(MODE_LABEL[s.response_mode].toLowerCase());
  return parts.join(" · ");
}

export function PronounsView({ onBack }: { onBack: () => void }) {
  const [view, setView] = useState<View>("home");
  const [config, setConfig] = useState<PronounConfig>(DEFAULT_CONFIG);
  const [assigned, setAssigned] = useState<Assigned[]>([]);
  const [due, setDue] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const load = () => setReloadKey((k) => k + 1);

  useEffect(() => {
    let cancelled = false;
    api("/api/pronoun-practice").then((body) => {
      if (cancelled) return;
      setConfig(body.config);
      setAssigned(body.sessions ?? []);
      setDue(body.due_difficulties ?? []);
      setLoadError(null);
    }).catch((e) => {
      // Offline or signed out: train with the defaults; answers wait in the queue.
      if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  if (typeof view === "object") {
    return (
      <PronounDrill
        settings={view.drill}
        enabledModes={config.modes}
        dueDifficulties={due}
        assignedSessionId={view.assignedId}
        title={view.title}
        onExit={() => { setView("home"); load(); }}
      />
    );
  }
  if (view === "settings") return <SettingsPanel config={config} onBack={() => setView("home")} onSaved={(c) => { setConfig(c); setView("home"); }} />;
  if (view === "stats") return <StatsPanel onBack={() => setView("home")} />;

  const own = sessionFromConfig(config);
  return (
    <section className="screen practice-view">
      <header className="screen-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
        <div>
          <p className="eyebrow">Практика</p>
          <h1>Личные местоимения</h1>
        </div>
      </header>

      {loadError && <p className="pron-load-error">Настройки с сервера не загрузились ({loadError}) — тренировка пойдёт со стандартными, ответы сохранятся позже.</p>}

      <div className="practice-list">
        {assigned.map((a) => (
          <button key={a.session_id} type="button" className="action-card study glass-card"
            onClick={() => setView({ drill: a.settings, assignedId: a.session_id, title: "От преподавателя" })}>
            <span className="action-card-icon"><UserCheck size={24} /></span>
            <span>
              <span className="action-card-label">От преподавателя{a.status === "started" ? " · начата" : ""}</span>
              <strong className="action-card-title">{a.settings.note || "Назначенная тренировка"}</strong>
              <span className="action-card-sub">{describeSettings(a.settings)}</span>
            </span>
            <ChevronRight size={20} className="action-card-arrow" />
          </button>
        ))}

        <button type="button" className="action-card pronouns glass-card" disabled={loading}
          onClick={() => setView({ drill: own, assignedId: null, title: "Местоимения" })}>
          <span className="action-card-icon"><Play size={24} /></span>
          <span>
            <span className="action-card-label">Тренировка</span>
            <strong className="action-card-title">Начать: {own.item_count} заданий</strong>
            <span className="action-card-sub">{describeSettings(own)}{due.length ? ` · повторить: ${due.length}` : ""}</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>

        <button type="button" className="action-card glass-card" onClick={() => setView("stats")}>
          <span className="action-card-icon"><BarChart3 size={24} /></span>
          <span>
            <span className="action-card-label">Статистика</span>
            <strong className="action-card-title">Что получается, а что путается</strong>
            <span className="action-card-sub">Подлежащее и дополнение отдельно · письмо и голос отдельно</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>

        <button type="button" className="action-card glass-card" onClick={() => setView("settings")}>
          <span className="action-card-icon"><Settings2 size={24} /></span>
          <span>
            <span className="action-card-label">Настройки</span>
            <strong className="action-card-title">Пройденные блоки и глаголы</strong>
            <span className="action-card-sub">{config.constructions.map((c) => CONSTRUCTION_LABEL[c]).join(" · ")}</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>
      </div>
    </section>
  );
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Chips<T extends string>({ items, selected, label, onToggle, disabledItem }: { items: readonly T[]; selected: T[]; label: (t: T) => string; onToggle: (t: T) => void; disabledItem?: (t: T) => boolean }) {
  return (
    <div className="filter-chips">
      {items.map((t) => (
        <button key={t} type="button" className={`filter-chip${selected.includes(t) ? " active" : ""}`} aria-pressed={selected.includes(t)}
          onClick={() => onToggle(t)} title={disabledItem?.(t) ? "Включите нужный блок" : undefined} style={disabledItem?.(t) && selected.includes(t) ? { opacity: 0.55 } : undefined}>
          {label(t)}
        </button>
      ))}
    </div>
  );
}

function SettingsPanel({ config, onBack, onSaved }: { config: PronounConfig; onBack: () => void; onSaved: (c: PronounConfig) => void }) {
  const [draft, setDraft] = useState<PronounConfig>(config);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const set = (patch: Partial<PronounConfig>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const { version: _v, case: _c, ...patch } = draft;
      void _v; void _c;
      const body = await api("/api/pronoun-practice", { method: "PUT", body: JSON.stringify({ config: patch }) });
      if (body.warnings?.length) setMessage(body.warnings.join(" "));
      onSaved(body.config);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="screen practice-view pron-settings">
      <header className="screen-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
        <div>
          <p className="eyebrow">Местоимения</p>
          <h1>Настройки</h1>
        </div>
      </header>
      <div className="verb-quiz-card">
        <div className="pron-setting">
          <h2>Пройденные блоки</h2>
          <p className="verb-quiz-translation">Включайте то, что уже разобрали: невключённое в задания не попадает. Падеж — только Akkusativ.</p>
          <Chips items={CONSTRUCTIONS} selected={draft.constructions} label={(c: Construction) => CONSTRUCTION_LABEL[c]} onToggle={(c) => set({ constructions: toggle(draft.constructions, c) })} />
        </div>
        <div className="pron-setting">
          <h2>Знакомые глаголы</h2>
          <Chips items={VERBS.map((v) => v.id)} selected={draft.verbs} label={verbLabel} onToggle={(v) => set({ verbs: toggle(draft.verbs, v) })}
            disabledItem={(id) => !verbUsable(VERBS.find((v) => v.id === id)!, draft.constructions)} />
          {draft.verbs.some((id) => !verbUsable(VERBS.find((v) => v.id === id)!, draft.constructions)) && (
            <p className="verb-quiz-translation">Бледные глаголы не используются, пока не включён их блок.</p>
          )}
        </div>
        <div className="pron-setting">
          <h2>Режимы</h2>
          <p className="verb-quiz-translation">Выбор вариантов используется после ошибки — для разбора конкретной трудности.</p>
          <Chips items={RESPONSE_MODES} selected={draft.modes} label={(m: ResponseMode) => MODE_LABEL[m]} onToggle={(m) => set({ modes: toggle(draft.modes, m) })} />
        </div>
        <div className="pron-setting">
          <h2>Фокус</h2>
          <Chips items={FOCUSES} selected={draft.focus} label={(f: Focus) => FOCUS_LABEL[f]} onToggle={(f) => set({ focus: toggle(draft.focus, f) })} />
          <Chips items={PRONOUN_IDS} selected={draft.target_pronouns} label={(p) => PRONOUNS[p].label} onToggle={(p) => set({ target_pronouns: toggle(draft.target_pronouns, p) })} />
        </div>
        <div className="pron-setting pron-setting-row">
          <label><input type="checkbox" checked={draft.hints_before_first_answer} onChange={(e) => set({ hints_before_first_answer: e.target.checked })} /> Подсказки до первого ответа</label>
          <label><input type="checkbox" checked={draft.include_delayed_review} onChange={(e) => set({ include_delayed_review: e.target.checked })} /> Возвращать прошлые трудности</label>
          <label>Заданий в сессии{" "}
            <select value={draft.session_length} onChange={(e) => set({ session_length: Number(e.target.value) })}>
              {[8, 10, 12, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        {message && <p className="noun-quiz-hint">{message}</p>}
        <div className="pron-actions">
          <button type="button" className="primary-btn" onClick={save} disabled={saving}>{saving ? "Сохраняю…" : "Сохранить"}</button>
          <button type="button" className="secondary-btn" onClick={onBack}>Отмена</button>
        </div>
      </div>
    </section>
  );
}

const STATUS_LABEL: Record<string, string> = { confident: "уверенно", practising: "в работе", recognition_only: "только узнавание", not_started: "—" };

function Meter({ label, ok, total }: { label: string; ok: number; total: number }) {
  const p = total ? Math.round((ok / total) * 100) : 0;
  return (
    <li className="pron-meter">
      <span>{label}</span>
      <span className="pron-meter-bar" aria-hidden><span style={{ width: `${p}%` }} /></span>
      <b>{total ? `${ok}/${total}` : "—"}</b>
    </li>
  );
}

function StatsPanel({ onBack }: { onBack: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api("/api/pronoun-practice?stats=1").then((b) => setStats(b.stats)).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);
  const parts: Component[] = ["subject", "object", "conjugation", "sentence_type", "word_order", "government", "separable_prefix", "negation"];
  return (
    <section className="screen practice-view pron-stats">
      <header className="screen-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
        <div>
          <p className="eyebrow">Местоимения</p>
          <h1>Статистика</h1>
        </div>
      </header>
      {error && <p className="pron-load-error">Не удалось загрузить: {error}</p>}
      {!stats && !error && <p className="verb-quiz-loading">Загружаю…</p>}
      {stats && stats.first_answers.answers === 0 && <p className="verb-quiz-translation">Пока нет ответов — статистика появится после первой тренировки.</p>}
      {stats && stats.first_answers.answers > 0 && (
        <div className="verb-quiz-card">
          <div className="pron-setting">
            <h2>Первые ответы</h2>
            <ul className="pron-meters">
              <Meter label="Самостоятельно (письмо, голос)" ok={stats.first_independent_answers.correct} total={stats.first_independent_answers.checked} />
              <Meter label="Все режимы" ok={stats.first_answers.correct} total={stats.first_answers.checked} />
              {Object.entries(stats.by_mode).map(([m, t]) => <Meter key={m} label={MODE_LABEL[m as ResponseMode] ?? m} ok={t.correct} total={t.checked} />)}
            </ul>
            <p className="verb-quiz-translation">
              {stats.coverage.sessions} сесс. · {stats.coverage.combinations} сочетаний · отсроченные проверки {stats.delayed_checks.correct}/{stats.delayed_checks.checked}
              {stats.technical_problems ? ` · технических сбоев ${stats.technical_problems} (не в ошибках)` : ""}
              {stats.awaiting_review ? ` · ждут проверки ${stats.awaiting_review}` : ""}
            </p>
          </div>
          <div className="pron-setting">
            <h2>По частям ответа</h2>
            <ul className="pron-meters">
              {parts.filter((c) => stats.by_component[c]).map((c) => <Meter key={c} label={COMPONENT_LABEL[c]} ok={stats.by_component[c].correct + stats.by_component[c].typos} total={stats.by_component[c].checked} />)}
            </ul>
          </div>
          {stats.confusion_matrix.length > 0 && (
            <div className="pron-setting">
              <h2>Частые путаницы</h2>
              <ul className="pron-confusions">
                {stats.confusion_matrix.slice(0, 8).map((c, i) => (
                  <li key={i}><span>{c.role === "subject" ? "подлежащее" : "дополнение"}</span> <b>{c.expected}</b> → <b className="miss">{c.answered}</b> <em>×{c.count}</em></li>
                ))}
              </ul>
            </div>
          )}
          {stats.mastery.length > 0 && (
            <div className="pron-setting">
              <h2>Навыки</h2>
              <ul className="pron-confusions">
                {stats.mastery.map((m) => (
                  <li key={m.difficulty}><span>{labelDifficulty(m.difficulty)}</span> <em className={`pron-status ${m.status}`}>{STATUS_LABEL[m.status]}</em>
                    <small> узн. {m.recognition.correct}/{m.recognition.checked} · письмо {m.written.correct}/{m.written.checked} · голос {m.spoken.correct}/{m.spoken.checked}</small></li>
                ))}
              </ul>
              <p className="verb-quiz-translation">«Уверенно» — только после самостоятельных ответов в нескольких сессиях и на разных глаголах.</p>
            </div>
          )}
          {stats.recent_difficulties.length > 0 && (
            <div className="pron-setting">
              <h2>Последние ошибки</h2>
              <ul className="pron-summary-misses">
                {stats.recent_difficulties.slice(0, 6).map((d, i) => (
                  <li key={i}>
                    <span>{d.prompt}</span>
                    <span>Ответ: {d.first_answer || "«не знаю»"}</span>
                    <b>{d.expected}</b>
                    {d.correction && <em>исправление: {d.correction.answer} ({d.correction.outcome === "correct" ? "верно" : "неверно"})</em>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
