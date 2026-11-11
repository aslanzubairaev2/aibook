// Styles for CardsView.tsx, kept out of the component so the file that holds the logic
// is not also a few hundred lines of CSS.

export const CARDS_STYLES = `
        /* Glass, not a lid. It has to hide what scrolls under it — a
           transparent sticky bar let the statistics run through the title,
           which read as two screens printed on top of each other — but a flat
           fill of --bg-primary painted a black rectangle over the warm glow the
           app-shell puts at the top of every screen, and that rectangle was the
           first thing on the page. A translucent tinted panel was still a
           visible box. So: no fill and no rule — only a strong blur of what
           scrolls beneath, fading out at the bottom. Over the still glow a blur
           changes nothing, so at rest the header is the page itself; text that
           scrolls under it turns to haze instead of overprinting the title. */
        .srs-preview-stage { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: calc(100svh - 260px); }
        .srs-sticky-header { position: sticky; top: 0; z-index: 30; margin: -20px -16px 16px; padding: 16px 16px 14px; border-bottom: none; background: transparent; backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px); -webkit-mask-image: linear-gradient(to bottom, #000 86%, transparent); mask-image: linear-gradient(to bottom, #000 86%, transparent); }
        /* Where the browser cannot blur, fall back to a fill opaque enough to
           hide the scrolling content — the panel is still warm, not black. */
        @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
          .srs-sticky-header { background: var(--bg-secondary); }
        }
        @media (min-width: 640px) { .srs-sticky-header { margin: -28px -24px 16px; padding: 24px 24px 14px; } }
        .srs-tabs-container { display: flex; gap: 4px; padding: 4px; margin-bottom: 14px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: var(--radius-lg); }
        .srs-tab { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 4px; background: transparent; border: none; border-radius: var(--radius-md); font-weight: 700; font-size: 13px; color: var(--text-muted); transition: all 0.2s; cursor: pointer; }
        .srs-tab.active { color: var(--accent); background: var(--bg-card); box-shadow: var(--shadow-sm); }
        .srs-tab-badge { display: inline-flex; align-items: center; justify-content: center; min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: rgba(212, 168, 71, 0.12); color: var(--accent); font-size: 10px; font-weight: 800; }
        .srs-tab-badge.empty { background: rgba(240, 230, 211, 0.08); color: var(--text-muted); }
        .srs-tab.active .srs-tab-badge:not(.empty) { background: var(--accent); color: var(--bg-primary); }
        .srs-stats-banner { display: flex; align-items: center; justify-content: space-between; gap: 4px; padding: 8px 12px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); }
        .srs-today { padding: 11px 13px 9px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); }
        .srs-today-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
        .srs-today-lead { display: flex; align-items: baseline; gap: 7px; min-width: 0; }
        .srs-today-remaining { font-size: 27px; font-weight: 900; line-height: 1; color: var(--accent); font-variant-numeric: tabular-nums; }
        .srs-today-lbl { font-size: 11px; font-weight: 700; color: var(--text-muted); }
        .srs-today-side { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; flex-shrink: 0; }
        .srs-today-done { font-size: 13px; font-weight: 850; font-variant-numeric: tabular-nums; }
        .srs-today-sub { font-size: 10px; font-weight: 700; color: var(--text-muted); }
        .srs-today-bar { height: 6px; margin: 9px 0 8px; border-radius: 99px; overflow: hidden; background: rgba(240, 230, 211, 0.08); }
        .srs-today-bar i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--accent), var(--green)); transition: width 0.35s ease; }
        .srs-today-foot { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .srs-today-chip { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 750; color: var(--text-muted); white-space: nowrap; }
        .srs-today-foot .srs-stats-toggle { margin-left: auto; width: auto; height: 26px; padding: 0 9px; gap: 5px; font-size: 11px; font-weight: 800; }
        .srs-stat-mini { display: flex; align-items: center; gap: 5px; }
        .srs-stat-mini .srs-stat-val { font-size: 14px; font-weight: 900; line-height: 1; display: flex; align-items: center; gap: 3px; }
        .srs-stat-mini .srs-stat-lbl { font-size: 10px; color: var(--text-muted); font-weight: 700; white-space: nowrap; }
        .srs-stat-divider { width: 1px; height: 16px; background: var(--border); flex-shrink: 0; }
        .mode-switch { display: inline-flex; padding: 3px; gap: 2px; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 999px; }
        .mode-switch-opt { padding: 6px 14px; border-radius: 999px; border: none; background: transparent; font-size: 13px; font-weight: 700; color: var(--text-muted); cursor: pointer; transition: all 0.2s; }
        .mode-switch-opt.active { background: var(--accent); color: var(--bg-primary); }
        .audio-prompt { display: flex; flex-direction: column; align-items: center; gap: 10px; }
        .audio-play-btn { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; border-radius: 50%; border: 1px solid var(--accent); background: rgba(212, 168, 71, 0.12); color: var(--accent); cursor: pointer; transition: all 0.2s; }
        .audio-play-btn:active { transform: scale(0.94); }
        .audio-prompt-lbl { font-size: 12px; color: var(--text-muted); font-weight: 700; }
        .flipper-perspective { perspective: 1000px; width: 100%; max-width: 420px; margin: 0 auto 16px; }
        .flipper-card { width: 100%; position: relative; display: grid; transform-style: preserve-3d; transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1); cursor: pointer; }
        .flipper-card.flipped { transform: rotateY(180deg); }
        /* Three rows that know their own place: the actions, the text, the
           footer. The column is minmax(0, 1fr) rather than the implicit auto —
           an auto column is sized by its widest item's min-content, and the
           footer's single nowrap line (a source title can be a whole lesson
           name) blew that column past the card, which is what pushed long
           sentences off the right-hand edge instead of wrapping them. */
        .flipper-face { grid-area: 1 / 1; position: relative; width: 100%; min-width: 0; min-height: 200px; max-height: min(62vh, 560px); backface-visibility: hidden; -webkit-backface-visibility: hidden; border-radius: var(--radius-lg); border: 1px solid var(--border-strong); display: grid; grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr) auto; gap: 10px; padding: 12px 14px; box-shadow: var(--shadow-sm); overflow: hidden; }
        .flipper-face-front { background: linear-gradient(135deg, var(--bg-elevated) 0%, rgba(212, 168, 71, 0.04) 100%); }
        .flipper-face-back { pointer-events: none; background: linear-gradient(135deg, var(--bg-elevated) 0%, rgba(122, 171, 106, 0.04) 100%); transform: rotateY(180deg); }
        .flipper-card.flipped .flipper-face-front { pointer-events: none; }
        .flipper-card.flipped .flipper-face-back { pointer-events: auto; }
        .card-actions-right { grid-row: 1; grid-column: 1; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
        .card-action-btn { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: var(--radius-md); border: 1px solid var(--border-strong); background: var(--bg-card); color: var(--text-primary); cursor: pointer; transition: all 0.18s ease; padding: 0; box-shadow: var(--shadow-xs); }
        .card-action-btn:hover:not(:disabled) { background: var(--bg-elevated); border-color: var(--accent); color: var(--accent); transform: translateY(-1px); }
        .card-action-btn:active:not(:disabled) { transform: scale(0.95); }
        .card-action-btn:disabled { opacity: 0.5; cursor: default; }
        .card-actions-right .speak-btn { width: 44px; height: 44px; border-radius: var(--radius-md); border: 1px solid var(--border-strong); background: var(--bg-card); color: var(--accent); transition: all 0.18s ease; box-shadow: var(--shadow-xs); }
        .card-actions-right .speak-btn:hover { background: var(--bg-elevated); border-color: var(--accent); transform: translateY(-1px); }
        .card-actions-right .speak-btn:active { transform: scale(0.95); }
        /* A sentence that outgrows even the tallest card scrolls inside it
           rather than reflowing the page under the grade buttons. */
        .card-text-area { grid-row: 2; grid-column: 1; min-width: 0; min-height: 0; width: 100%; display: flex; align-items: center; justify-content: center; overflow-y: auto; overflow-x: hidden; overscroll-behavior: contain; overflow-wrap: anywhere; word-break: break-word; hyphens: auto; text-align: center; }
        .card-text-area > * { min-width: 0; max-width: 100%; }
        .card-footer-row { grid-row: 3; grid-column: 1; align-self: end; min-width: 0; width: 100%; display: flex; gap: 10px; justify-content: space-between; align-items: center; flex-shrink: 0; font-size: 12px; color: var(--text-muted); }
        .card-footer-row span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .card-tts-wrap { position: relative; flex-shrink: 0; }
        .tts-menu { position: absolute; top: calc(100% + 6px); right: 0; background: var(--bg-card); border: 1px solid var(--border-strong); border-radius: var(--radius-md); padding: 4px; z-index: 200; min-width: 130px; box-shadow: var(--shadow-sm); }
        .tts-menu-item { padding: 8px 12px; border-radius: var(--radius-sm); font-size: 13px; font-weight: 600; cursor: pointer; color: var(--text-primary); transition: background 0.15s; white-space: nowrap; }
        .tts-menu-item:hover { background: var(--bg-elevated); }
        .tts-menu-item.active { color: var(--accent); }
        .srs-grade-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; width: 100%; max-width: 420px; margin: 0 auto; }
        .srs-keys-link { display: none; }
        @media (hover: hover) and (pointer: fine) {
          .srs-keys-link { display: inline-flex; align-items: center; gap: 5px; margin: 12px auto 0; padding: 4px 8px; border: none; border-radius: 999px; background: transparent; color: var(--text-muted); font-size: 10.5px; font-weight: 700; cursor: pointer; transition: color 0.18s; }
          .srs-keys-link:hover { color: var(--accent); }
        }
        /* The three directions, in the open above the card. Fully rounded, the
           same shape as the mode switch beside them — a pill next to a
           near-rectangle is the mismatch that made this row look unfinished. */
        /* What the sources are set to, in one line. The list itself is behind
           it, because the list can be a thousand rows long. */
        .srs-source-btn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); cursor: pointer; text-align: left; transition: all 0.18s ease; }
        .srs-source-btn:hover { border-color: var(--border-strong); }
        .srs-source-btn.active { border-color: var(--accent); color: var(--accent); }
        .srs-source-btn svg { flex-shrink: 0; }
        .srs-source-btn-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 1px; }
        .srs-source-btn-copy strong { font-size: 13px; font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .srs-source-btn-copy small { font-size: 11px; color: var(--text-muted); }
        .srs-dir-row { display: flex; justify-content: center; gap: 6px; width: 100%; max-width: 420px; margin: 0 auto; flex-wrap: wrap; }
        .srs-dir-chip { padding: 6px 14px; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); font-size: 12px; font-weight: 750; cursor: pointer; transition: all 0.18s ease; }
        .srs-dir-chip:hover { border-color: var(--border-strong); color: var(--text-primary); }
        .srs-dir-chip.active { border-color: var(--accent); background: var(--accent); color: var(--bg-primary); }
        .grade-btn { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 11px 4px; font-size: 14px; border: 1px solid var(--border); border-radius: var(--radius-md); font-weight: 800; cursor: pointer; background: var(--bg-elevated); transition: all 0.2s; color: var(--text-primary); }
        .grade-btn:active { transform: scale(0.96); }
        .grade-btn-1 { border-color: rgba(224, 136, 136, 0.3); }
        .grade-btn-1:hover, .grade-btn-1:active { background: rgba(224, 136, 136, 0.1); border-color: #e08888; }
        .grade-btn-2 { border-color: rgba(106, 152, 196, 0.3); }
        .grade-btn-2:hover, .grade-btn-2:active { background: rgba(106, 152, 196, 0.1); border-color: var(--blue); }
        .grade-btn-3 { border-color: rgba(122, 171, 106, 0.3); }
        .grade-btn-3:hover, .grade-btn-3:active { background: rgba(122, 171, 106, 0.1); border-color: var(--green); }
        .grade-btn-4 { border-color: rgba(212, 168, 71, 0.3); }
        .grade-btn-4:hover, .grade-btn-4:active { background: rgba(212, 168, 71, 0.1); border-color: var(--accent); }
        .grade-score { font-size: 15px; font-weight: 900; margin-bottom: 2px; }
        .grade-lbl { font-size: 10px; color: var(--text-muted); }
        .grade-btn-1 { color: #e08888; }
        .leech-chip { display: inline-flex; align-items: center; gap: 4px; flex-shrink: 0; max-width: none; padding: 2px 8px; border: 1px solid rgba(224, 136, 136, 0.45); border-radius: 999px; background: rgba(224, 136, 136, 0.1); color: #e08888; font: inherit; font-size: 11px; font-weight: 800; cursor: pointer; }
        .leech-chip:hover { background: rgba(224, 136, 136, 0.18); }
        .all-card-leech { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 800; color: #e08888; background: rgba(224, 136, 136, 0.12); }
        .grade-btn-3 { color: var(--green); }
        .grade-btn-4 { color: var(--accent); }
        .grade-btn-1 .grade-score { color: #e08888; }
        .grade-btn-2 .grade-score { color: var(--blue); }
        .grade-btn-3 .grade-score { color: var(--green); }
        .grade-btn-4 .grade-score { color: var(--accent); }
        .srs-history-open { display: flex; align-items: center; justify-content: center; gap: 9px; width: 100%; max-width: 420px; margin: 10px auto 0; padding: 9px 12px; border: 1px solid transparent; border-radius: var(--radius-md); background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.18s ease; }
        .srs-history-open:hover { border-color: var(--border); background: var(--bg-elevated); color: var(--text-primary); }
        .srs-history-open-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; line-height: 1.2; }
        .srs-history-open-copy strong { font-size: 12px; font-weight: 800; }
        .srs-history-open-copy small { font-size: 10px; color: var(--text-muted); }
        .srs-history-view { width: 100%; max-width: 420px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
        .srs-history-banner { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid rgba(122, 171, 106, 0.25); border-radius: var(--radius-md); background: rgba(122, 171, 106, 0.07); color: var(--green); }
        .srs-history-banner-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 1px; }
        .srs-history-banner-copy strong { font-size: 12px; font-weight: 850; }
        .srs-history-banner-copy span { font-size: 10px; color: var(--text-muted); }
        .srs-history-close { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; border: none; border-radius: 50%; background: transparent; color: var(--text-muted); cursor: pointer; }
        .srs-history-close:hover { background: rgba(240, 230, 211, 0.08); color: var(--text-primary); }
        .srs-history-card { position: relative; min-height: 250px; display: flex; flex-direction: column; justify-content: center; padding: 56px 22px 46px; border: 1px solid var(--border-strong); border-radius: var(--radius-lg); background: linear-gradient(145deg, var(--bg-elevated), rgba(122, 171, 106, 0.04)); box-shadow: var(--shadow-sm); text-align: center; overflow: hidden; }
        .srs-history-card-head { position: absolute; top: 14px; left: 14px; right: 14px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
        .srs-history-direction { padding: 4px 8px; border-radius: 6px; background: rgba(212, 168, 71, 0.12); color: var(--accent); font-size: 10px; font-weight: 850; text-transform: uppercase; letter-spacing: 0.04em; }
        .srs-history-word-row { display: flex; align-items: center; justify-content: center; gap: 8px; }
        .srs-history-word { min-width: 0; font-size: clamp(22px, 7vw, 30px); font-weight: 850; line-height: 1.25; overflow-wrap: anywhere; }
        .srs-history-divider { width: 42px; height: 1px; margin: 16px auto 13px; background: var(--border-strong); }
        .srs-history-label { margin-bottom: 5px; color: var(--text-muted); font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
        .srs-history-meaning { color: var(--accent); font-size: 18px; font-weight: 750; line-height: 1.35; white-space: pre-line; overflow-wrap: anywhere; }
        .srs-history-details { margin-top: 7px; color: var(--text-muted); font-size: 13px; line-height: 1.4; white-space: pre-line; overflow-wrap: anywhere; }
        .srs-history-source { position: absolute; left: 14px; right: 14px; bottom: 14px; overflow: hidden; color: var(--text-muted); font-size: 11px; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
        .srs-history-nav { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .srs-history-nav-btn { display: flex; align-items: center; justify-content: center; gap: 5px; min-height: 42px; padding: 8px 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-primary); font-size: 12px; font-weight: 800; cursor: pointer; transition: all 0.18s ease; }
        .srs-history-nav-btn:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
        .srs-history-nav-btn:disabled { opacity: 0.35; cursor: default; }
        .all-search-bar { display: flex; align-items: center; gap: 8px; border: 1px solid var(--border); background: var(--bg-card); border-radius: 999px; padding: 0 14px; height: 40px; margin-bottom: 12px; min-width: 0; }
        .all-search-input { flex: 1; min-width: 0; background: transparent; border: none; color: var(--text-primary); outline: none; font-size: 14px; }
        .card-row-delete-btn { color: var(--text-muted); background: transparent; border: none; padding: 8px; border-radius: var(--radius-sm); cursor: pointer; transition: all 0.2s; }
        .card-row-delete-btn:hover { color: var(--accent); background: rgba(212, 168, 71, 0.08); }
        .card-row-delete-btn.danger:hover { color: #e08888; background: rgba(224, 136, 136, 0.08); }
        .all-card-row { display: flex; flex-direction: column; gap: 4px; cursor: pointer; transition: border-color 0.15s; }
        .all-card-row:hover { border-color: var(--border-strong); }
        .all-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
        .all-card-markers { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; min-width: 0; padding-top: 4px; }
        .all-card-status { font-size: 10px; padding: 2px 6px; border-radius: 4px; font-weight: 800; }
        .all-card-actions { display: flex; gap: 0; flex-shrink: 0; margin: -4px -8px 0 0; }
        .all-card-actions .card-row-delete-btn { padding: 7px; line-height: 0; }
        .all-card-front { display: flex; align-items: center; gap: 6px; font-size: 16px; margin: 2px 0 0; min-width: 0; overflow-wrap: anywhere; }
        .all-card-row .card-back-summary { font-size: 13px; }
        .all-card-row .card-verb-forms { justify-content: flex-start; font-size: 13px; }
        .filter-chips { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
        .filter-chip { padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 700; cursor: pointer; border: 1px solid var(--border); background: var(--bg-elevated); color: var(--text-muted); transition: all 0.2s; white-space: nowrap; }
        .filter-chip.active { background: rgba(212, 168, 71, 0.15); border-color: var(--accent); color: var(--accent); }
        .book-select { width: 100%; max-width: 100%; background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 20px; color: var(--text-muted); font-size: 12px; font-weight: 700; padding: 5px 10px; cursor: pointer; outline: none; }
        .book-select:focus { border-color: var(--accent); color: var(--accent); }
        .all-toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 10px; }
        .all-toolbar .all-search-bar { flex: 1; margin-bottom: 0; }
        .all-filter-toggle { display: flex; align-items: center; gap: 6px; padding: 0 14px; height: 40px; flex-shrink: 0; white-space: nowrap; border-radius: 999px; border: 1px solid var(--border); background: var(--bg-card); color: var(--text-muted); font-size: 13px; font-weight: 700; cursor: pointer; transition: all 0.2s; }
        .all-filter-toggle.active { border-color: var(--accent); color: var(--accent); }
        .all-filter-count { display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: var(--accent); color: var(--bg-primary); font-size: 10px; font-weight: 800; }
        .all-filter-panel { border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-card); padding: 12px; margin-bottom: 12px; display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-sm); }
        .filter-group-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); margin-bottom: 6px; }
        .filter-reset-btn { align-self: flex-start; font-size: 12px; font-weight: 700; color: var(--text-muted); background: transparent; border: none; cursor: pointer; padding: 4px 0; text-decoration: underline; }
        .filter-reset-btn:hover { color: var(--accent); }
        .srs-stats-toggle { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex-shrink: 0; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.18s ease; }
        .srs-stats-toggle:hover, .srs-stats-toggle.active { background: rgba(212, 168, 71, 0.12); color: var(--accent); }
        .srs-stats-panel { display: flex; flex-direction: column; gap: 18px; padding: 14px; margin-bottom: 12px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-card); box-shadow: var(--shadow-sm); }
        .srs-stats-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
        .srs-stats-section-label { font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-primary); }
        .srs-stats-note { flex-shrink: 0; font-size: 10px; font-weight: 700; color: var(--text-muted); text-align: right; }
        .srs-stats-empty { font-size: 11px; font-weight: 700; color: var(--text-muted); }
        .srs-bar-row { display: flex; align-items: center; gap: 9px; padding: 3px 0; }
        .srs-bar-label { flex-shrink: 0; width: 108px; font-size: 11px; font-weight: 750; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .srs-bar-track { flex: 1; min-width: 0; height: 9px; border-radius: 99px; overflow: hidden; background: rgba(240, 230, 211, 0.08); }
        .srs-bar-track i { display: block; height: 100%; border-radius: 99px; transition: width 0.35s ease; }
        .srs-bar-value { flex-shrink: 0; min-width: 64px; text-align: right; font-size: 11px; font-weight: 850; font-variant-numeric: tabular-nums; }
        .srs-bar-value small { font-weight: 700; color: var(--text-muted); }
        .srs-stats-legend-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 9px; font-size: 11px; font-weight: 700; color: var(--text-muted); }
        .srs-stats-legend-row span { display: inline-flex; align-items: center; gap: 5px; }
        .srs-stats-legend-row i { width: 8px; height: 8px; border-radius: 2px; }
        .srs-stats-insight { padding: 10px 12px; border-radius: var(--radius-sm); background: rgba(212, 168, 71, 0.08); border: 1px solid rgba(212, 168, 71, 0.2); font-size: 12px; font-weight: 700; line-height: 1.4; color: var(--text-primary); }
        .srs-stat-bar { display: flex; height: 8px; width: 100%; border-radius: 99px; overflow: hidden; background: rgba(240, 230, 211, 0.07); }
        .srs-stat-bar i { display: block; height: 100%; }
        .srs-stat-legend { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 11px; font-weight: 700; color: var(--text-muted); }
        .srs-stat-legend span { display: inline-flex; align-items: center; gap: 5px; }
        .srs-stat-legend i { width: 8px; height: 8px; border-radius: 2px; }
        .srs-forecast { display: grid; grid-template-columns: repeat(7, 1fr); gap: 5px; height: 88px; }
        /* Four rows — number, bar, weekday, date — so the bars are measured
           against a track of their own. Sized as a share of the whole column,
           they came out compressed and a peak twice another's size barely
           looked taller. */
        .srs-forecast-col { display: grid; grid-template-rows: auto 1fr auto auto; justify-items: center; gap: 2px; min-width: 0; }
        .srs-forecast-track { display: flex; align-items: flex-end; width: 100%; height: 100%; }
        /* One column, two stacked segments: what is still due sits above what
           has already been reviewed today. */
        .srs-forecast-stack { display: flex; flex-direction: column; justify-content: flex-end; width: 100%; min-height: 3px; }
        .srs-forecast-bar { width: 100%; min-height: 2px; background: rgba(212, 168, 71, 0.55); }
        .srs-forecast-stack > .srs-forecast-bar:first-child { border-radius: 3px 3px 0 0; }
        .srs-forecast-stack > .srs-forecast-bar:last-child { border-radius: 0 0 2px 2px; }
        .srs-forecast-stack > .srs-forecast-bar:only-child { border-radius: 3px 3px 2px 2px; }
        .srs-forecast-bar.done { background: var(--green); }
        .srs-forecast-bar.empty { background: rgba(212, 168, 71, 0.18); }
        .srs-forecast-lbl { font-size: 9px; font-weight: 700; color: var(--text-muted); white-space: nowrap; }
        .srs-forecast-date { font-size: 8px; font-weight: 700; color: rgba(240, 230, 211, 0.28); line-height: 1; }
        .srs-forecast-col.today .srs-forecast-lbl { color: var(--accent); }
        .srs-forecast-col.today .srs-forecast-val { color: var(--accent); }
        .srs-forecast-val { font-size: 10px; font-weight: 800; color: var(--text-primary); }
        .srs-forecast-key { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 8px; font-size: 10px; font-weight: 700; color: var(--text-muted); }
        .srs-forecast-key span { display: inline-flex; align-items: center; gap: 5px; }
        .srs-forecast-key i { width: 8px; height: 8px; border-radius: 2px; background: rgba(212, 168, 71, 0.55); }
        .srs-forecast-key i.done { background: var(--green); }
        .srs-source-row { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--border); font-size: 12px; }
        .srs-source-row:first-of-type { border-top: none; }
        .srs-source-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; }
        .srs-source-meta { flex-shrink: 0; font-size: 11px; font-weight: 700; color: var(--text-muted); }
        .srs-source-due { flex-shrink: 0; min-width: 34px; text-align: right; font-size: 11px; font-weight: 800; color: var(--accent); }
        .srs-list-more { margin: 10px auto 0; padding: 9px 16px; border: 1px solid var(--border); border-radius: var(--radius-md); background: var(--bg-elevated); color: var(--text-muted); font-size: 12px; font-weight: 700; cursor: pointer; }
        .srs-list-more:hover { border-color: var(--accent); color: var(--accent); }
        .srs-batch-banner { display: flex; align-items: center; gap: 10px; width: 100%; max-width: 460px; margin: 0 auto; padding: 9px 12px; border: 1px solid rgba(212, 168, 71, 0.3); border-radius: var(--radius-md); background: rgba(212, 168, 71, 0.08); color: var(--accent); }
        .srs-batch-copy { display: flex; flex: 1; min-width: 0; flex-direction: column; gap: 1px; }
        .srs-batch-copy strong { font-size: 12px; font-weight: 850; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .srs-batch-copy span { font-size: 10px; font-weight: 700; color: var(--text-muted); }
        .srs-batch-exit { flex-shrink: 0; padding: 6px 12px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--bg-card); color: var(--text-muted); font-size: 11px; font-weight: 800; cursor: pointer; transition: all 0.18s ease; }
        .srs-batch-exit:hover { border-color: var(--accent); color: var(--accent); }

        /* ── Zen: the trainer alone on the screen ──────────────────────────
           Everything the page carries around the card — header, counters,
           tabs, mode switch, filters — is chrome you read once and then scroll
           past a hundred times. Here it is simply not there: the card sits in
           the middle of the viewport with its four grades directly beneath it,
           so a session is a run of taps in one place with no scrolling between
           them. Kept under the player's z-index (40) and under the
           modals' so speaking, looking a word up and discussing all still work
           from inside it. */
        .srs-zen { position: fixed; inset: 0; z-index: 35; max-width: none; margin: 0; padding: 0; background: var(--bg-primary); overscroll-behavior: contain; }

        /* The !important through this block is not emphasis: several of the
           elements being hidden carry their layout in inline styles, and an
           override layer that only applies in zen has no other way to win. */
        .srs-zen .srs-sticky-header,
        .srs-zen .srs-today,
        .srs-zen .srs-stats-panel,
        .srs-zen .srs-tabs-container,
        .srs-zen .srs-train-controls,
        .srs-zen .srs-batch-banner,
        .srs-zen .srs-train-progress,
        .srs-zen .srs-keys-link, .srs-zen .srs-dir-row { display: none !important; }

        /* The scroll container, so a card taller than the screen can still be
            reached. Its bottom padding is the player's own strip, reserved
            whether or not anything is playing — that is the point: it used to
            be added only while the player was up, which moved the grades out
            from under a thumb already on its way down every time playback
            ended, and a missed tap grades the wrong card. */
        .srs-zen .srs-train-tab { position: absolute; inset: 0; gap: 0 !important; overflow-y: auto; overscroll-behavior: contain; padding: calc(env(safe-area-inset-top, 0px) + 8px) 14px calc(env(safe-area-inset-bottom, 16px) + 56px); }
        .srs-zen .srs-train-stage { min-height: 100%; }

        /* The card, its grades and the way back to the last one are one block,
            centred in the screen. The buttons are placed by the card and
            nothing else: they move only when the card does, which is only ever
            in answer to a tap. What must never move them is the player, and it
            cannot — the strip it floats over is reserved whether or not
            anything is playing.

            The centring is done with a pair of auto margins rather than
            justify-content so that the top line stays at the top, and so that
            a card too tall for the screen scrolls from its top edge instead of
            being cut off at both ends. */
        .srs-zen .zen-topbar { margin-bottom: auto; }
        .srs-zen .srs-train-stage::after { content: ""; margin-top: auto; }
        .srs-zen .flipper-perspective { margin-bottom: 12px !important; }
        .srs-zen .srs-history-view { margin-top: auto; margin-bottom: auto; }

        .zen-topbar { position: sticky; top: 0; z-index: 3; display: flex; align-items: center; gap: 10px; width: 100%; max-width: 420px; margin: 0 auto; padding: 2px 0 8px; background: transparent; backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px); }
        .zen-progress { flex: 1; min-width: 0; height: 3px; border-radius: 99px; overflow: hidden; background: rgba(240, 230, 211, 0.09); }
        .zen-progress i { display: block; height: 100%; border-radius: 99px; background: var(--accent); transition: width 0.35s ease; }
        .zen-count { flex-shrink: 0; font-size: 11px; font-weight: 800; color: var(--text-muted); font-variant-numeric: tabular-nums; }
        .zen-topbar-btn { display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; flex-shrink: 0; border: none; border-radius: 50%; background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.18s ease; }
        .zen-topbar-btn:hover { background: rgba(240, 230, 211, 0.08); color: var(--text-primary); }

        .srs-zen .srs-grade-row { margin-top: 0; margin-bottom: 0; }
        /* Straight under the grades, where it is in the ordinary trainer —
            quieter here, because in an empty screen a full block of text
            competes with the card. */
        .srs-zen .srs-history-open { margin-top: 6px; padding: 7px 12px; }

        .zen-toggle { display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; flex-shrink: 0; border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--bg-card); color: var(--text-muted); cursor: pointer; transition: all 0.2s; }
        .zen-toggle:hover { border-color: var(--accent); color: var(--accent); }
`;
