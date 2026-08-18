"use client";

// Which of the learner's sources a session draws from.
//
// This started as a row of chips, one per source, printed straight into the
// filter panel. With thirty-five packs it buried every other filter under a
// wall of names; with a thousand it would be unusable, and the number of packs
// only ever goes up. A list that can be a thousand rows long needs the three
// things a wall of chips cannot have: a search box, a page at a time, and the
// few entries that are actually switched on kept where they can be seen.
//
// It answers both halves of one question — train only this, or train
// everything but these — because they are the same decision made from opposite
// ends, and splitting them across two controls is what made the panel confusing
// in the first place.

import { useMemo, useState } from "react";
import { Check, Eye, EyeOff, Layers, Search, X } from "lucide-react";
import { matchesSourceQuery, type CardSource } from "@/lib/cards";

type Props = {
  sources: CardSource[];
  /** The one source being trained, or null for all of them. */
  selectedKey: string | null;
  excluded: string[];
  /** Train only this source; null goes back to all of them. */
  onSelect: (source: CardSource | null) => void;
  onToggleExcluded: (key: string) => void;
  onClearExcluded: () => void;
  onClose: () => void;
};

/** One page of the list. Long enough to scroll, short enough to render. */
const PAGE = 40;

export function SourcePickerModal({
  sources, selectedKey, excluded, onSelect, onToggleExcluded, onClearExcluded, onClose,
}: Props) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(PAGE);

  const excludedSet = useMemo(() => new Set(excluded), [excluded]);

  // The switched-off ones lead, whatever the search says: an exclusion set last
  // week is the thing a learner cannot find when the queue turns up empty, and
  // it must never be somewhere down a list of a thousand.
  const off = useMemo(
    () => sources.filter((s) => excludedSet.has(s.key)),
    [sources, excludedSet],
  );
  const rest = useMemo(
    () => sources.filter((s) => !excludedSet.has(s.key) && matchesSourceQuery(s, query)),
    [sources, excludedSet, query],
  );

  const shown = rest.slice(0, visible);
  const trainedCards = rest.reduce((sum, s) => sum + s.cards, 0);

  return (
    <div className="modal-backdrop word-modal-backdrop" onClick={onClose}>
      <section
        className="word-modal source-picker"
        role="dialog"
        aria-modal
        aria-label="Источники тренировки"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-top-bar">
          <button className="icon-btn" onClick={onClose} type="button" aria-label="Закрыть">
            <X size={20} />
          </button>
          <strong className="source-picker-title">Источники</strong>
        </div>

        <label className="source-picker-search">
          <Search size={15} />
          <input
            type="text"
            value={query}
            autoComplete="off"
            placeholder="Найти книгу или пачку"
            aria-label="Поиск по источникам"
            onChange={(e) => { setQuery(e.target.value); setVisible(PAGE); }}
          />
          {query && (
            <button type="button" aria-label="Очистить" onClick={() => setQuery("")}>
              <X size={14} />
            </button>
          )}
        </label>

        <button
          type="button"
          className={`source-row source-row-all${selectedKey === null ? " selected" : ""}`}
          onClick={() => onSelect(null)}
        >
          <Layers size={15} />
          <span className="source-row-title">Все источники</span>
          <span className="source-row-count">{trainedCards}</span>
          {selectedKey === null && <Check size={15} className="source-row-check" />}
        </button>

        {off.length > 0 && (
          <>
            <div className="source-picker-section">
              Исключены · {off.length}
              <button type="button" onClick={onClearExcluded}>вернуть все</button>
            </div>
            {off.map((source) => (
              <SourceRow
                key={source.key}
                source={source}
                excluded
                selected={selectedKey === source.key}
                onSelect={() => onSelect(source)}
                onToggleExcluded={() => onToggleExcluded(source.key)}
              />
            ))}
          </>
        )}

        <div className="source-picker-section">
          {query ? `Найдено · ${rest.length}` : `В тренировке · ${rest.length}`}
        </div>

        {shown.map((source) => (
          <SourceRow
            key={source.key}
            source={source}
            excluded={false}
            selected={selectedKey === source.key}
            onSelect={() => onSelect(source)}
            onToggleExcluded={() => onToggleExcluded(source.key)}
          />
        ))}

        {rest.length === 0 && <p className="source-picker-empty">Ничего не нашлось.</p>}

        {visible < rest.length && (
          <button type="button" className="secondary-btn source-picker-more" onClick={() => setVisible((n) => n + PAGE)}>
            Показать ещё ({rest.length - visible})
          </button>
        )}

        <p className="source-picker-hint">
          Нажмите на источник, чтобы тренировать только его. Глаз справа — исключить из тренировки,
          не трогая остальные.
        </p>
      </section>
    </div>
  );
}

function SourceRow({
  source, excluded, selected, onSelect, onToggleExcluded,
}: {
  source: CardSource;
  excluded: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleExcluded: () => void;
}) {
  return (
    <div className={`source-row-wrap${excluded ? " excluded" : ""}`}>
      <button
        type="button"
        className={`source-row${selected ? " selected" : ""}`}
        onClick={onSelect}
        title={`Тренировать только «${source.title}»`}
      >
        <span className="source-row-title">{source.title}</span>
        <span className="source-row-count">{source.cards}</span>
        {selected && <Check size={15} className="source-row-check" />}
      </button>
      <button
        type="button"
        className={`source-row-eye${excluded ? " off" : ""}`}
        onClick={onToggleExcluded}
        aria-pressed={excluded}
        aria-label={excluded ? `Вернуть «${source.title}» в тренировку` : `Исключить «${source.title}» из тренировки`}
        title={excluded ? "Вернуть в тренировку" : "Исключить из тренировки"}
      >
        {excluded ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}
