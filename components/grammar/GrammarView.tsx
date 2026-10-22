"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BarChart3, BookOpen, ChevronRight, FlaskConical, Play, Settings2, UserCheck } from "lucide-react";
import { sbAuthHeaders } from "@/lib/db/supabase";
import { getLocalNamespace } from "@/lib/db/local";
import { CASE_LABEL, FAMILY_LABEL, FAMILIES, GENDER_LABEL, type Case, type Family, type Gender } from "@/lib/grammar/common";
import { BLOCK_LABEL, DATIVE_BLOCKS, FRAMES, type ArtConfig, type Block } from "@/lib/grammar/articles";
import { TRAINER_TITLE, defaultConfig, emptyReasons, type GrammarConfig, type SessionSettings } from "@/lib/grammar/config";
import type { grammarSummary } from "@/lib/grammar/stats";
import { MODES, MODE_LABEL, type Mode, type TrainerId } from "@/lib/grammar/task";
import { COMBOS, SENTENCE_LABEL, SENTENCE_TYPES, VP_PREPOSITIONS, type SentenceType, type VPConfig } from "@/lib/grammar/verbPrepositions";
import { CheatSheet } from "./CheatSheet";
import { GrammarDrill } from "./GrammarDrill";

type Assigned = { session_id: string; status: string; settings: SessionSettings; created_at: string };
type Stats = ReturnType<typeof grammarSummary>;
type Run = { config: GrammarConfig; mode: Mode | "mixed"; limit: number; assignedId: string | null; title: string };
type View = "home" | "settings" | "stats" | { run: Run };

async function api(path: string, init?: RequestInit) {
  const headers = await sbAuthHeaders();
  const res = await fetch(path, { ...init, headers: { "Content-Type": "application/json", ...headers, ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}

const TEST_KEY = "aibook:grammar:test-run";

/** A developer's switch: answers are marked test_run and stay out of every statistic. */
export function readTestRun(): boolean {
  try { return window.localStorage.getItem(TEST_KEY) === "1" || new URLSearchParams(window.location.search).get("test") === "1"; } catch { return false; }
}

function cacheKey(trainer: TrainerId) {
  return `aibook:grammar:${trainer}:${getLocalNamespace()}`;
}

type Cached = { config: GrammarConfig; due: string[] };

function readCached(trainer: TrainerId): Cached | null {
  try { const raw = window.localStorage.getItem(cacheKey(trainer)); return raw ? JSON.parse(raw) as Cached : null; } catch { return null; }
}

function writeCached(trainer: TrainerId, value: Cached) {
  try { window.localStorage.setItem(cacheKey(trainer), JSON.stringify(value)); } catch { /* storage blocked: defaults next time */ }
}

export function sizeLabel(limit: number): string {
  return limit > 0 ? `${limit} заданий` : "без конца";
}

export function GrammarView({ trainer, onBack }: { trainer: TrainerId; onBack: () => void }) {
  const [view, setView] = useState<View>("home");
  const [config, setConfig] = useState<GrammarConfig>(() => (typeof window === "undefined" ? null : readCached(trainer))?.config ?? defaultConfig(trainer));
  const [due, setDue] = useState<string[]>(() => (typeof window === "undefined" ? null : readCached(trainer))?.due ?? []);
  const [assigned, setAssigned] = useState<Assigned[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [testRun, setTestRun] = useState(() => (typeof window === "undefined" ? false : readTestRun()));
  const [mode, setMode] = useState<Mode | "mixed">(config.mode);
  const [limit, setLimit] = useState<number>(config.set_size);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    let cancelled = false;
    api(`/api/grammar-trainers/${trainer}`).then((body) => {
      if (cancelled) return;
      setConfig(body.config);
      setMode(body.config.mode);
      setLimit(body.config.set_size);
      setDue(body.due ?? []);
      setAssigned(body.sessions ?? []);
      writeCached(trainer, { config: body.config, due: body.due ?? [] });
      setLoadError(null);
    }).catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [trainer, reload]);

  const reasons = useMemo(() => emptyReasons(trainer, config), [trainer, config]);
  const title = TRAINER_TITLE[trainer];

  if (typeof view === "object") {
    return (
      <GrammarDrill trainer={trainer} config={view.run.config} mode={view.run.mode} limit={view.run.limit} due={due}
        assignedSessionId={view.run.assignedId} title={view.run.title} testRun={testRun}
        onExit={() => { setView("home"); setReload((k) => k + 1); }} />
    );
  }
  if (view === "settings") return <SettingsPanel trainer={trainer} config={config} onBack={() => setView("home")} onSaved={(c) => { setConfig(c); setMode(c.mode); setLimit(c.set_size); writeCached(trainer, { config: c, due }); setView("home"); }} />;
  if (view === "stats") return <StatsPanel trainer={trainer} onBack={() => setView("home")} />;

  const setCustomLimit = (raw: string) => {
    setCustom(raw);
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0 && n <= 200) setLimit(n);
  };

  return (
    <section className="screen practice-view gr-home">
      <header className="screen-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
        <div>
          <p className="eyebrow">Практика</p>
          <h1>{title}</h1>
        </div>
        <button type="button" className="gr-sheet-btn" onClick={() => setSheet(true)} aria-label="Открыть шпаргалку"><BookOpen size={16} /> Шпаргалка</button>
      </header>

      {loadError && <p className="pron-load-error">Настройки с сервера не загрузились ({loadError}) — тренировка пойдёт с сохранёнными на этом устройстве, ответы отправятся позже.</p>}

      <div className="practice-list">
        {assigned.map((a) => (
          <button key={a.session_id} type="button" className="action-card study glass-card"
            onClick={() => setView({ run: { config: a.settings.config, mode: a.settings.mode, limit: a.settings.item_count, assignedId: a.session_id, title: "От преподавателя" } })}>
            <span className="action-card-icon"><UserCheck size={24} /></span>
            <span>
              <span className="action-card-label">От преподавателя{a.status === "started" ? " · начата" : ""}</span>
              <strong className="action-card-title">{a.settings.note || "Назначенная тренировка"}</strong>
              <span className="action-card-sub">{MODE_LABEL[a.settings.mode as Mode] ?? "смешанный режим"} · {sizeLabel(a.settings.item_count)}</span>
            </span>
            <ChevronRight size={20} className="action-card-arrow" />
          </button>
        ))}

        <div className="verb-quiz-card gr-start">
          <div className="pron-setting">
            <h2>Режим</h2>
            <div className="filter-chips">
              {[...MODES, "mixed" as const].map((m) => (
                <button key={m} type="button" className={`filter-chip${mode === m ? " active" : ""}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                  {m === "mixed" ? "Вперемешку" : MODE_LABEL[m]}
                </button>
              ))}
            </div>
            {mode === "quick" && trainer === "verb_prepositions" && <p className="verb-quiz-translation">Быстрый выбор тренирует выбор конструкции и не заменяет самостоятельную сборку.</p>}
          </div>
          <div className="pron-setting">
            <h2>Сколько</h2>
            <div className="filter-chips">
              {[0, 10, 20].map((n) => (
                <button key={n} type="button" className={`filter-chip${limit === n && !custom ? " active" : ""}`} aria-pressed={limit === n} onClick={() => { setLimit(n); setCustom(""); }}>
                  {n === 0 ? "Без конца" : n}
                </button>
              ))}
              <input className="gr-custom-count" inputMode="numeric" placeholder="своё" value={custom} onChange={(e) => setCustomLimit(e.target.value.replace(/\D/g, ""))} aria-label="Своё число заданий" />
            </div>
          </div>
          {reasons.length > 0 ? (
            <div className="pron-clarify"><p>Нечего тренировать: {reasons.join(" ")}</p><button type="button" className="secondary-btn" onClick={() => setView("settings")}>Открыть настройки</button></div>
          ) : (
            <button type="button" className="primary-btn gr-start-btn" onClick={() => setView({ run: { config, mode, limit, assignedId: null, title } })}>
              <Play size={16} style={{ marginRight: 6 }} /> Начать · {sizeLabel(limit)}{due.length ? ` · вернётся трудностей: ${due.length}` : ""}
            </button>
          )}
          <p className="verb-quiz-translation">{describe(trainer, config)}</p>
        </div>

        <button type="button" className="action-card glass-card" onClick={() => setView("stats")}>
          <span className="action-card-icon"><BarChart3 size={24} /></span>
          <span>
            <span className="action-card-label">Статистика</span>
            <strong className="action-card-title">Что получается, а что путается</strong>
            <span className="action-card-sub">Выбор, сборка, письмо и голос отдельно · самостоятельно и с подсказкой отдельно</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>

        <button type="button" className="action-card glass-card" onClick={() => setView("settings")}>
          <span className="action-card-icon"><Settings2 size={24} /></span>
          <span>
            <span className="action-card-label">Настройки</span>
            <strong className="action-card-title">{trainer === "verb_prepositions" ? "Изученные сочетания и фильтры" : "Падежи, род, определители"}</strong>
            <span className="action-card-sub">Весь каталог доступен сразу — включайте то, что прошли</span>
          </span>
          <ChevronRight size={20} className="action-card-arrow" />
        </button>

        <label className="gr-test-toggle">
          <input type="checkbox" checked={testRun} onChange={(e) => { setTestRun(e.target.checked); try { window.localStorage.setItem(TEST_KEY, e.target.checked ? "1" : "0"); } catch { /* per session only */ } }} />
          <FlaskConical size={14} /> Тестовый режим: ответы помечаются как проверка и не входят в статистику
        </label>
      </div>
      {sheet && <CheatSheet trainer={trainer} onClose={() => setSheet(false)} />}
    </section>
  );
}

function describe(trainer: TrainerId, config: GrammarConfig): string {
  if (trainer === "verb_prepositions") {
    const c = config as VPConfig;
    const ids = c.selection === "learned" ? c.learned : c.manual;
    return `${c.selection === "learned" ? "Изученные" : "Выбранные"} сочетания: ${ids.length} · ${c.cases.map((x) => (x === "acc" ? "Akk" : "Dat")).join(" + ")}${c.prepositions.length ? ` · предлоги: ${c.prepositions.join(", ")}` : ""}${c.include_no_prep ? " · с глаголами без предлога" : ""}`;
  }
  const c = config as ArtConfig;
  return `${c.cases.map((x) => CASE_LABEL[x]).join(" + ")} · ${c.genders.map((g) => (g === "pl" ? "мн. ч." : GENDER_LABEL[g])).join(", ")} · ${c.families.join(", ")} · пропусков: ${c.gaps === "one" ? "1" : c.gaps === "two" ? "2" : "1–2"}`;
}

function toggle<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

function Chips<T extends string>({ items, selected, label, onToggle }: { items: readonly T[]; selected: T[]; label: (t: T) => string; onToggle: (t: T) => void }) {
  return (
    <div className="filter-chips">
      {items.map((t) => (
        <button key={t} type="button" className={`filter-chip${selected.includes(t) ? " active" : ""}`} aria-pressed={selected.includes(t)} onClick={() => onToggle(t)}>{label(t)}</button>
      ))}
    </div>
  );
}

function SettingsPanel({ trainer, config, onBack, onSaved }: { trainer: TrainerId; config: GrammarConfig; onBack: () => void; onSaved: (c: GrammarConfig) => void }) {
  const [draft, setDraft] = useState<GrammarConfig>(config);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const reasons = useMemo(() => emptyReasons(trainer, draft), [trainer, draft]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const { version: _v, ...patch } = draft;
      void _v;
      const body = await api(`/api/grammar-trainers/${trainer}`, { method: "PUT", body: JSON.stringify({ config: patch }) });
      onSaved(body.config);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="screen practice-view pron-settings gr-settings">
      <header className="screen-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
        <div>
          <p className="eyebrow">{TRAINER_TITLE[trainer]}</p>
          <h1>Настройки</h1>
        </div>
      </header>
      <div className="verb-quiz-card">
        {trainer === "verb_prepositions"
          ? <VerbSettings draft={draft as VPConfig} set={(p) => setDraft((d) => ({ ...(d as VPConfig), ...p }))} />
          : <ArticleSettings draft={draft as ArtConfig} set={(p) => setDraft((d) => ({ ...(d as ArtConfig), ...p }))} />}
        <div className="pron-setting">
          <h2>Режим и длина по умолчанию</h2>
          <Chips items={[...MODES, "mixed"] as (Mode | "mixed")[]} selected={[draft.mode]} label={(m) => (m === "mixed" ? "Вперемешку" : MODE_LABEL[m as Mode])} onToggle={(m) => setDraft((d) => ({ ...d, mode: m }))} />
          <Chips items={["0", "10", "20"]} selected={[String(draft.set_size)]} label={(n) => (n === "0" ? "Без конца" : `${n} заданий`)} onToggle={(n) => setDraft((d) => ({ ...d, set_size: Number(n) }))} />
        </div>
        {reasons.length > 0 && <p className="pron-load-error">С такими настройками заданий не будет: {reasons.join(" ")}</p>}
        {message && <p className="noun-quiz-hint">{message}</p>}
        <div className="pron-actions">
          <button type="button" className="primary-btn" onClick={save} disabled={saving}>{saving ? "Сохраняю…" : "Сохранить"}</button>
          <button type="button" className="secondary-btn" onClick={onBack}>Отмена</button>
        </div>
      </div>
    </section>
  );
}

function VerbSettings({ draft, set }: { draft: VPConfig; set: (p: Partial<VPConfig>) => void }) {
  const listKey = draft.selection === "learned" ? "learned" : "manual";
  const chosen = draft[listKey];
  const groups: { title: string; ids: string[] }[] = [
    { title: "С предлогом + Akkusativ", ids: COMBOS.filter((c) => c.prep && c.case === "acc" && !c.reflexive && !c.person).map((c) => c.id) },
    { title: "С предлогом + Dativ", ids: COMBOS.filter((c) => c.prep && c.case === "dat").map((c) => c.id) },
    { title: "Кому-то + за что / о чём", ids: COMBOS.filter((c) => c.person).map((c) => c.id) },
    { title: "Возвратные", ids: COMBOS.filter((c) => c.reflexive).map((c) => c.id) },
    { title: "Без предлога", ids: COMBOS.filter((c) => !c.prep).map((c) => c.id) },
  ];
  const label = (id: string) => COMBOS.find((c) => c.id === id)!.label.replace(/ \+ .*$/, "");
  return (
    <>
      <div className="pron-setting">
        <h2>Что тренировать</h2>
        <Chips items={["learned", "manual"] as const} selected={[draft.selection]} label={(s) => (s === "learned" ? "Изученные сочетания" : "Ручной выбор")} onToggle={(s) => set({ selection: s })} />
        <p className="verb-quiz-translation">
          {draft.selection === "learned" ? "Отмечайте сочетания, которые уже разобрали. Сначала изучено только warten auf и глаголы без предлога." : "Выберите любые сочетания каталога — они не станут «изученными»."}
        </p>
        {draft.selection === "manual" && (
          <div className="pron-actions">
            <button type="button" className="secondary-btn" onClick={() => set({ manual: COMBOS.map((c) => c.id) })}>Весь каталог</button>
            <button type="button" className="secondary-btn" onClick={() => set({ manual: [] })}>Очистить</button>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.title} className="gr-group">
            <h3>{g.title}</h3>
            <Chips items={g.ids} selected={chosen} label={label} onToggle={(id) => set({ [listKey]: toggle(chosen, id) } as Partial<VPConfig>)} />
          </div>
        ))}
      </div>
      <div className="pron-setting">
        <h2>Фильтры</h2>
        <p className="verb-quiz-translation">Предлог отбирает настоящие сочетания из выбранных — к другим глаголам он не подставляется. Пусто — все предлоги.</p>
        <Chips items={VP_PREPOSITIONS} selected={draft.prepositions} label={(p) => p} onToggle={(p) => set({ prepositions: toggle(draft.prepositions, p) })} />
        <Chips items={["acc", "dat"] as const} selected={draft.cases} label={(c) => (c === "acc" ? "Akkusativ" : "Dativ")} onToggle={(c) => set({ cases: toggle(draft.cases, c) })} />
        <Chips items={SENTENCE_TYPES} selected={draft.sentence_types} label={(t: SentenceType) => SENTENCE_LABEL[t]} onToggle={(t) => set({ sentence_types: toggle(draft.sentence_types, t) })} />
        <Chips items={["pronoun", "noun"] as const} selected={draft.objects} label={(o) => (o === "pronoun" ? "Дополнение-местоимение" : "Дополнение-существительное")} onToggle={(o) => set({ objects: toggle(draft.objects, o) })} />
      </div>
      <div className="pron-setting pron-setting-row">
        <label><input type="checkbox" checked={draft.include_no_prep} onChange={(e) => set({ include_no_prep: e.target.checked })} /> Конструкции без предлога (sehen, hören, suchen…)</label>
        <label><input type="checkbox" checked={draft.reflexive} onChange={(e) => set({ reflexive: e.target.checked })} /> Возвратные глаголы</label>
        <label><input type="checkbox" checked={draft.separable} onChange={(e) => set({ separable: e.target.checked })} /> Отделяемые глаголы</label>
        <label><input type="checkbox" checked={draft.modal} onChange={(e) => set({ modal: e.target.checked })} /> С модальным können</label>
      </div>
    </>
  );
}

function ArticleSettings({ draft, set }: { draft: ArtConfig; set: (p: Partial<ArtConfig>) => void }) {
  const listKey = draft.selection === "learned" ? "learned" : "manual";
  const chosen = draft[listKey];
  const byBlock = (b: Block) => FRAMES.filter((f) => f.block === b).map((f) => f.id);
  const label = (id: string) => FRAMES.find((f) => f.id === id)!.label;
  return (
    <>
      <div className="pron-setting">
        <h2>Падежи, род, число</h2>
        <Chips items={["nom", "acc", "dat"] as Case[]} selected={draft.cases} label={(c) => CASE_LABEL[c]} onToggle={(c) => set({ cases: toggle(draft.cases, c) })} />
        {draft.cases.includes("dat") && (
          <>
            <p className="verb-quiz-translation">Блоки Dativ: mit, bei и zu — основа; глаголы с Dativ и geben / schenken включаются отдельно.</p>
            <Chips items={DATIVE_BLOCKS} selected={draft.dative_blocks} label={(b) => BLOCK_LABEL[b]} onToggle={(b) => set({ dative_blocks: toggle(draft.dative_blocks, b) })} />
          </>
        )}
        <Chips items={["m", "f", "n", "pl"] as Gender[]} selected={draft.genders} label={(g) => (g === "pl" ? "Множественное" : GENDER_LABEL[g])} onToggle={(g) => set({ genders: toggle(draft.genders, g) })} />
      </div>
      <div className="pron-setting">
        <h2>Определители</h2>
        <Chips items={FAMILIES} selected={draft.families} label={(f: Family) => FAMILY_LABEL[f]} onToggle={(f) => set({ families: toggle(draft.families, f) })} />
      </div>
      <div className="pron-setting pron-setting-row">
        <label><input type="checkbox" checked={draft.show_gender} onChange={(e) => set({ show_gender: e.target.checked })} /> Показывать род существительного (der Drucker)</label>
        <Chips items={["one", "two", "mixed"] as const} selected={[draft.gaps]} label={(g) => (g === "one" ? "Один пропуск" : g === "two" ? "Два пропуска" : "Один или два")} onToggle={(g) => set({ gaps: g })} />
      </div>
      <div className="pron-setting">
        <h2>Конструкции</h2>
        <Chips items={["learned", "manual"] as const} selected={[draft.selection]} label={(s) => (s === "learned" ? "Изученные" : "Ручной выбор")} onToggle={(s) => set({ selection: s })} />
        {draft.selection === "manual" && (
          <div className="pron-actions">
            <button type="button" className="secondary-btn" onClick={() => set({ manual: FRAMES.map((f) => f.id) })}>Весь каталог</button>
            <button type="button" className="secondary-btn" onClick={() => set({ manual: [] })}>Очистить</button>
          </div>
        )}
        {(["nom", "acc", ...DATIVE_BLOCKS] as Block[]).map((b) => (
          <div key={b} className="gr-group">
            <h3>{BLOCK_LABEL[b]}</h3>
            <Chips items={byBlock(b)} selected={chosen} label={label} onToggle={(id) => set({ [listKey]: toggle(chosen, id) } as Partial<ArtConfig>)} />
          </div>
        ))}
      </div>
    </>
  );
}

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

const KIND_LABEL: Record<string, string> = { independent: "Самостоятельно", assisted: "Со шпаргалкой", dont_know: "«Не знаю»" };

function StatsPanel({ trainer, onBack }: { trainer: TrainerId; onBack: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api(`/api/grammar-trainers/${trainer}?stats=1`).then((b) => setStats(b.stats)).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [trainer]);
  return (
    <section className="screen practice-view pron-stats">
      <header className="screen-header">
        <button className="icon-btn" onClick={onBack} type="button" aria-label="Назад"><ArrowLeft size={20} /></button>
        <div>
          <p className="eyebrow">{TRAINER_TITLE[trainer]}</p>
          <h1>Статистика</h1>
        </div>
      </header>
      {error && <p className="pron-load-error">Не удалось загрузить: {error}</p>}
      {!stats && !error && <p className="verb-quiz-loading">Загружаю…</p>}
      {stats && stats.first_answers.answers === 0 && <p className="verb-quiz-translation">Пока нет ответов — статистика появится после первой тренировки.</p>}
      {stats && stats.first_answers.answers > 0 && (
        <div className="verb-quiz-card">
          <div className="pron-setting">
            <h2>Первые ответы по режимам</h2>
            <ul className="pron-meters">
              {MODES.filter((m) => stats.by_mode[m]).map((m) => <Meter key={m} label={MODE_LABEL[m]} ok={stats.by_mode[m].right} total={stats.by_mode[m].checked} />)}
              {Object.entries(stats.by_answer_kind).filter(([k]) => KIND_LABEL[k]).map(([k, t]) => <Meter key={k} label={KIND_LABEL[k]} ok={t.right} total={t.checked} />)}
            </ul>
            <p className="verb-quiz-translation">
              {stats.sessions} сесс. · исправлений {stats.corrections.count}, из них верных {stats.corrections.right_after_correction}
              {stats.technical_problems ? ` · технических сбоев ${stats.technical_problems} (не в ошибках)` : ""}
              {stats.awaiting_review ? ` · ждут проверки ${stats.awaiting_review}` : ""}
            </p>
          </div>
          {stats.error_types.length > 0 && (
            <div className="pron-setting">
              <h2>Виды ошибок</h2>
              <ul className="pron-confusions">{stats.error_types.map((e) => <li key={e.type}><b>{e.label}</b> <em>×{e.count}</em></li>)}</ul>
            </div>
          )}
          {stats.constructions.length > 0 && (
            <div className="pron-setting">
              <h2>Конструкции</h2>
              <ul className="pron-confusions">
                {stats.constructions.slice(0, 12).map((c) => (
                  <li key={c.key}><span>{c.label}</span> <b>{c.right}/{c.checked}</b>{c.errors.length > 0 && <small> {c.errors.map((e) => `${e.label} ×${e.count}`).join(" · ")}</small>}</li>
                ))}
              </ul>
            </div>
          )}
          {stats.recent_errors.length > 0 && (
            <div className="pron-setting">
              <h2>Последние ошибки</h2>
              <ul className="pron-summary-misses">
                {stats.recent_errors.slice(0, 6).map((d, i) => (
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
