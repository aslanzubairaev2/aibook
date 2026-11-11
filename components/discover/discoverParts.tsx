"use client";

// The catalogue list pieces: a collapsible level section, one lesson row and
// the loading skeleton. Moved out of DiscoverView.tsx unchanged.

import type { SharedBook } from "./DiscoverView";
import type { CSSProperties, ReactNode } from "react";
import { ChevronRight, Loader2, CheckCircle2, PlayCircle, Clock, Trash2, ExternalLink, Pencil } from "lucide-react";
import { type Coverage } from "@/lib/text/vocab";

export type LevelSectionProps = {
  levelTitle: string;
  headerStyle?: CSSProperties;
  timelineStyle?: CSSProperties;
  counterText: string;
  collapsed: boolean;
  onToggle: () => void;
  children: ReactNode;
};

export function LevelSection({ levelTitle, headerStyle, timelineStyle, counterText, collapsed, onToggle, children }: LevelSectionProps) {
  return (
    <div className="syllabus-level-section">
      <button type="button" className="syllabus-level-header syllabus-level-toggle" style={headerStyle} onClick={onToggle} aria-expanded={!collapsed}>
        <ChevronRight size={16} className="level-chevron" style={{ transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.2s" }} />
        <span>{levelTitle}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.85 }}>{counterText}</span>
      </button>
      {!collapsed && (
        <div className="syllabus-timeline" style={timelineStyle}>
          {children}
        </div>
      )}
    </div>
  );
}

// ── Sub-component: Syllabus Item ─────────────────────────────────────────────

export type SyllabusItemProps = {
  book: SharedBook;
  progress?: { status: "not_started" | "in_progress" | "completed"; percentage: number };
  isLoading: boolean;
  showLang?: boolean;
  /** Null when the text has no frequency data yet — the badge is then hidden. */
  coverage?: Coverage | null;
  onOpen: () => void;
  /** Only generated lessons can be removed or revised — public content is shared. */
  onDelete?: () => void;
  onRefine?: () => void;
  onEdit?: () => void;
};

export const SOURCE_LABELS: Record<string, string> = {
  klexikon: "Klexikon",
  universal_cefr: "UniversalCEFR",
  generated: "ИИ",
  oersi: "OERSI",
};

export function SyllabusItem({ book, progress, isLoading, showLang, coverage, onOpen, onDelete, onRefine, onEdit }: SyllabusItemProps) {
  const status = progress?.status ?? "not_started";
  const sourceUrl = book.metadata?.source_url;
  const license = book.metadata?.license;
  const isGenerated = book.source_type === "generated";
  return (
    <div className={`syllabus-item ${status === "completed" ? "completed" : status === "in_progress" ? "active" : ""}`}>
      <span className="syllabus-node" style={{
        background: status === "completed" ? "#7aab6a" : status === "in_progress" ? "var(--accent)" : undefined,
        boxShadow: status !== "not_started" ? "0 0 8px currentColor" : undefined,
      }} />
      <div className="syllabus-meta">
        {showLang && <span>{book.language.toUpperCase()}</span>}
        {book.cefr_level && (
          <span title={book.metadata?.level_estimated ? "Уровень оценён автоматически по читаемости текста" : undefined}>
            {book.cefr_level}{book.metadata?.level_estimated ? "≈" : ""}
          </span>
        )}
        {showLang && <span>•</span>}
        {/* A generated document says which of the two it is: reading a text and
            working through a lesson are different intentions, and the list is
            where they are told apart. */}
        <span>
          {isGenerated
            ? book.metadata?.lesson_kind === "homework" ? "Домашка"
              : book.metadata?.lesson_kind === "lesson" ? "Урок" : "Текст"
            : SOURCE_LABELS[book.source_type] ?? book.source_type}
        </span>
        {coverage && (
          <span
            className={`coverage-chip${coverage.isComfortable ? " fits" : ""}`}
            title={
              coverage.isComfortable
                ? "Примерно одно слово из десяти новое — хорошая нагрузка для чтения"
                : `Знакомо ${Math.round(coverage.ratio * 100)}% слов текста`
            }
          >
            {coverage.isComfortable && "✓ "}{Math.round(coverage.ratio * 100)}% слов
          </span>
        )}
        {progress && progress.status !== "not_started" && (
          <span style={{ color: status === "completed" ? "#7aab6a" : "var(--accent)" }}>
            {status === "completed" ? "✓ Пройдено" : `${Math.round(progress.percentage)}%`}
          </span>
        )}
        {/* Up here rather than in the action row: three buttons do not fit a
            phone width, and delete is the rarest of them. */}
        {onDelete && (
          <button type="button" className="syllabus-delete" onClick={onDelete} title="Удалить урок" aria-label="Удалить урок">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      <h3 className="syllabus-title">{book.title}</h3>
      {book.metadata?.description && (
        <p className="syllabus-desc">{String(book.metadata.description)}</p>
      )}
      {sourceUrl && (
        <a className="syllabus-source" href={sourceUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={11} />Оригинал{license ? ` · ${license}` : ""}
        </a>
      )}
      <div className="syllabus-action-row">
        <button
          type="button"
          className="mini-btn"
          disabled={isLoading}
          style={
            status === "completed"
              ? { background: "rgba(122,171,106,0.2)", color: "#7aab6a", border: "1px solid rgba(122,171,106,0.4)", gap: 4 }
              : status === "in_progress"
              ? { background: "rgba(212,168,71,0.15)", color: "var(--accent)", border: "1px solid rgba(212,168,71,0.3)", gap: 4 }
              : { background: "rgba(212,168,71,0.08)", color: "var(--accent)", gap: 4 }
          }
          onClick={onOpen}
        >
          {isLoading ? (
            <><Loader2 className="spin" size={13} />Загрузка...</>
          ) : status === "completed" ? (
            <><CheckCircle2 size={13} />Читать заново</>
          ) : status === "in_progress" ? (
            <><Clock size={13} />Продолжить</>
          ) : (
            <><PlayCircle size={13} />
              {isGenerated && book.metadata?.lesson_kind === "homework" ? "Открыть"
                : isGenerated && book.metadata?.lesson_kind === "lesson" ? "Начать урок" : "Читать"}
            </>
          )}
        </button>
        {onRefine && (
          <button
            type="button"
            className="mini-btn syllabus-refine"
            onClick={onRefine}
            title="Изменить: правки, другой объём"
          >
            <Pencil size={13} />Изменить
          </button>
        )}
        {onEdit && (
          <button type="button" className="mini-btn syllabus-refine" onClick={onEdit} title="Изменить название и описание">
            <Pencil size={13} />Переименовать
          </button>
        )}
      </div>
    </div>
  );
}

export function CatalogSkeleton() {
  return (
    <div className="discover-grid">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="catalog-book catalog-book-skeleton">
          <span className="catalog-cover skeleton-block" />
          <span className="catalog-book-body">
            <span className="shimmer-line" />
            <span className="shimmer-line medium" />
          </span>
        </div>
      ))}
    </div>
  );
}
