// Styles for DiscoverView.tsx, kept out of the component so the file that holds the logic
// is not also a few hundred lines of CSS.

export const STYLES = `
  /* Both lesson forms live inside a modal now, which already provides the
     frame — so this is just the vertical rhythm. */
  .lesson-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* Keeps the primary button off the bottom edge of the sheet. */
    padding-bottom: 20px;
  }

  /* Floating "+" that opens the composer. Sits above the bottom nav (which is
     12px from the bottom and ~52px tall) and tracks the right edge of the
     640px content column on wide screens, falling back to a 16px inset on
     phones. */
  .add-lesson-fab {
    position: fixed;
    right: max(16px, calc(50% - 304px));
    bottom: 78px;
    z-index: 25;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    border: 0;
    border-radius: 50%;
    background: var(--accent);
    color: var(--text-dark);
    box-shadow: 0 6px 20px rgba(0,0,0,0.45), 0 0 0 1px rgba(212,168,71,0.35);
    transition: transform var(--transition-fast), background var(--transition-fast);
  }
  .add-lesson-fab:hover { background: var(--accent-bright); }
  .add-lesson-fab:active { transform: scale(0.92); }
  /* Sits directly above the primary one, smaller so the hierarchy is obvious. */
  .add-lesson-fab.secondary {
    bottom: 140px;
    width: 44px;
    height: 44px;
    background: rgba(39,35,25,0.96);
    color: var(--accent);
    box-shadow: 0 4px 14px rgba(0,0,0,0.4), 0 0 0 1px rgba(212,168,71,0.35);
  }
  .add-lesson-fab.secondary:hover { background: rgba(212,168,71,0.18); }
  /* A third tier, stacked the same distance above .secondary as .secondary sits above the primary FAB. */
  .add-lesson-fab.tertiary { bottom: 202px; }

  /* "You already know N% of the words here" — the closer to the comfort band,
     the more useful the text, so the band gets the accent colour. */
  .coverage-chip {
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 999px;
    color: var(--text-muted);
    font-weight: 700;
    letter-spacing: 0;
    text-transform: none;
  }
  .coverage-chip.fits {
    border-color: rgba(122,171,106,0.5);
    background: rgba(122,171,106,0.14);
    color: #8fbf7f;
  }

  .fits-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: transparent;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    transition: all var(--transition-fast);
  }
  .fits-toggle:hover { color: var(--text-primary); }
  .fits-toggle.on {
    border-color: rgba(122,171,106,0.5);
    background: rgba(122,171,106,0.14);
    color: #8fbf7f;
  }

  .refine-target {
    margin: 0;
    padding: 9px 11px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: rgba(240,230,211,0.04);
    color: var(--text-primary);
    font-size: 14px;
    font-weight: 600;
  }
  /* Step one of the composer: which of the two documents this is going to be.
     Two cards rather than a toggle, because the difference is what each one
     produces, and that needs a sentence to say. */
  .lesson-kind-picker { display: flex; flex-direction: column; gap: 10px; }
  .lesson-kind-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 5px;
    padding: 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg-elevated, rgba(0,0,0,0.2));
    color: var(--text-primary);
    text-align: left;
    cursor: pointer;
    transition: all 0.18s ease;
  }
  .lesson-kind-card:hover { border-color: var(--accent); transform: translateY(-1px); }
  .lesson-kind-card svg { color: var(--accent); }
  .lesson-kind-card strong { font-size: 15px; font-weight: 850; }
  .lesson-kind-card span { font-size: 12.5px; line-height: 1.45; color: var(--text-muted); }

  /* The pack a text or lesson is being built from, and the brief behind it. */
  .lesson-pack-note {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-left: 2px solid var(--accent);
    border-radius: 9px;
    background: rgba(212,168,71,0.06);
  }
  .lesson-pack-note strong { font-size: 12.5px; font-weight: 800; }
  .lesson-pack-note span { font-size: 11.5px; line-height: 1.45; color: var(--text-muted); }

  .lesson-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .lesson-field { display: flex; flex-direction: column; gap: 5px; }
  .lesson-field > span { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-muted); }
  .lesson-field > span em { font-style: normal; opacity: 0.6; text-transform: none; letter-spacing: 0; }
  .lesson-field > small { font-size: 11.5px; line-height: 1.4; color: var(--text-muted); opacity: 0.8; }
  .lesson-field input, .lesson-field select, .lesson-field textarea {
    width: 100%;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: 9px;
    background: var(--bg-elevated, rgba(0,0,0,0.2));
    color: var(--text-primary);
    font-size: 14px;
  }
  .lesson-field input, .lesson-field select { height: 38px; }
  .lesson-field textarea {
    padding: 9px 10px;
    font-family: inherit;
    line-height: 1.45;
    resize: vertical;
  }

  /* Text field paired with its dictation button. .dictate-btn itself lives in
     globals.css since DictateButton is shared across screens. */
  .lesson-input-row { display: flex; align-items: flex-start; gap: 8px; }
  .lesson-input-row > input, .lesson-input-row > textarea { flex: 1; min-width: 0; }

  .syllabus-refine { gap: 4px; color: var(--text-muted); background: rgba(240,230,211,0.05); }
  .syllabus-refine:hover { color: var(--accent); }
  .lesson-check { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--text-muted); }
  .lesson-check input { width: 16px; height: 16px; accent-color: var(--accent); }
  .lesson-words { display: flex; flex-wrap: wrap; gap: 5px; }
  .lesson-words span {
    padding: 3px 8px;
    border-radius: 999px;
    background: rgba(212,168,71,0.12);
    color: var(--accent);
    font-size: 11.5px;
  }

  .syllabus-source {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-muted);
    text-decoration: none;
  }
  .syllabus-source:hover { color: var(--accent); }
  .syllabus-delete {
    display: flex;
    align-items: center;
    margin-left: auto;
    padding: 2px;
    border: 0;
    background: transparent;
    color: var(--text-muted);
    opacity: 0.7;
    transition: color var(--transition-fast), opacity var(--transition-fast);
  }
  .syllabus-delete:hover { color: #d98080; opacity: 1; }

  .discover-tabs {
    position: sticky;
    top: 0;
    z-index: 15;
    display: flex;
    background: rgba(39,35,25,0.92);
    backdrop-filter: blur(20px);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 4px;
    margin-bottom: 18px;
    gap: 4px;
    /* Four tabs do not fit a phone width, so the row scrolls sideways. The
       scrollbar itself is hidden globally (see styles/globals.css); repeated
       here so the rule survives if that global ever changes. */
    overflow-x: auto;
    scrollbar-width: none;
    -webkit-overflow-scrolling: touch;
    /* Keeps a sideways swipe on the tabs from triggering the browser's
       back-navigation gesture. */
    overscroll-behavior-x: contain;
  }
  .discover-tabs::-webkit-scrollbar { display: none; }
  .discover-tab-btn {
    /* Grow to share the row when it fits, never shrink below the label — that
       is what makes the row overflow into a scroll instead of clipping text. */
    flex: 1 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 38px;
    padding: 0 12px;
    font-size: 12px;
    font-weight: 700;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    transition: all var(--transition-fast) cubic-bezier(0.4,0,0.2,1);
    cursor: pointer;
    white-space: nowrap;
  }
  .discover-tab-btn.active {
    background: var(--accent);
    color: var(--text-dark);
    box-shadow: 0 4px 12px rgba(212,168,71,0.22);
  }
  .discover-tab-btn:hover:not(.active) {
    color: var(--text-primary);
    background: rgba(240,230,211,0.05);
  }
  .seed-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 40px 24px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-md);
    background: rgba(39,35,25,0.44);
    backdrop-filter: blur(10px);
    margin: 20px 0;
  }
  .seed-card h3 { font-size: 18px; margin-top: 12px; margin-bottom: 8px; color: var(--text-primary); }
  .seed-card p { font-size: 13px; color: var(--text-muted); max-width: 380px; margin-bottom: 20px; line-height: 1.5; }
  .seed-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    font-weight: 700;
    font-size: 13px;
    background: var(--accent);
    color: var(--text-dark);
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: transform 0.2s;
  }
  .seed-btn:active { transform: scale(0.97); }
  .seed-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(10,10,10,0.85);
    backdrop-filter: blur(12px);
    padding: 16px;
  }
  .seed-modal {
    width: 100%;
    max-width: 460px;
    background: rgba(30,27,22,0.96);
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-md);
    padding: 24px;
    box-shadow: 0 20px 50px rgba(0,0,0,0.5);
    text-align: center;
  }
  .seed-progress-bar-wrap {
    width: 100%;
    height: 8px;
    background: rgba(240,230,211,0.1);
    border-radius: 99px;
    margin: 20px 0 10px;
    overflow: hidden;
  }
  .seed-progress-bar {
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, var(--accent) 0%, #8bc34a 100%);
    transition: width 0.3s ease-out;
  }
  .seed-log {
    font-family: monospace;
    font-size: 12px;
    color: var(--text-muted);
    background: rgba(20,18,16,0.7);
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    margin-top: 14px;
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .oersi-card {
    display: flex;
    flex-direction: column;
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: rgba(39,35,25,0.62);
    text-align: left;
    box-shadow: 0 6px 16px rgba(0,0,0,0.18);
  }
  .oersi-card strong { font-size: 15px; color: var(--text-primary); line-height: 1.3; margin-bottom: 6px; }
  .oersi-card p { font-size: 12px; color: var(--text-muted); margin-bottom: 12px; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .oersi-card em { font-size: 11px; color: var(--accent); font-style: normal; font-weight: 700; }
  .oersi-actions { display: flex; gap: 8px; margin-top: 12px; }
  .oersi-open-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 34px;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid rgba(212,168,71,0.25);
    border-radius: 6px;
    background: transparent;
    color: var(--accent);
    text-decoration: none;
    cursor: pointer;
    transition: all 0.2s;
  }
  .oersi-open-btn:hover { background: rgba(212,168,71,0.06); }
  .oersi-import-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 34px;
    font-size: 11px;
    font-weight: 700;
    border: 0;
    border-radius: 6px;
    background: var(--accent);
    color: var(--text-dark);
    cursor: pointer;
    transition: all 0.2s;
  }
  .oersi-import-btn:disabled { opacity: 0.5; }
  .syllabus-level-section { margin-bottom: 24px; text-align: left; }
  .syllabus-level-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 800;
    color: #fff;
    margin-bottom: 12px;
    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
  }
  .syllabus-level-toggle {
    width: 100%;
    cursor: pointer;
    text-align: left;
    border: 0;
    font-family: inherit;
    transition: filter 0.2s;
  }
  .syllabus-level-toggle:hover { filter: brightness(1.08); }
  .syllabus-level-toggle .level-chevron { flex-shrink: 0; }
  .syllabus-timeline {
    position: relative;
    padding-left: 20px;
    border-left: 2px solid var(--border);
    margin-left: 10px;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .syllabus-item {
    position: relative;
    background: rgba(39,35,25,0.54);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 14px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    transition: border-color 0.2s, background-color 0.2s;
  }
  .syllabus-item:hover { border-color: rgba(212,168,71,0.35); background: rgba(39,35,25,0.74); }
  .syllabus-item.active { border-color: rgba(212,168,71,0.2); }
  .syllabus-node {
    position: absolute;
    left: -27px;
    top: 18px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--border-strong);
    border: 2px solid var(--surface-dim);
    transition: background-color 0.2s;
  }
  .syllabus-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    /* The card is align-items: flex-start, so without this the row shrinks to
       its content and the delete button cannot push itself to the right edge. */
    width: 100%;
    margin-bottom: 4px;
    font-size: 11px;
    font-weight: 800;
    color: var(--accent);
  }
  .syllabus-title { font-size: 14px; font-weight: 700; color: var(--text-primary); margin: 0 0 4px; }
  .syllabus-desc { font-size: 12px; color: var(--text-muted); margin: 0 0 12px; line-height: 1.4; }
  /* Three buttons do not fit a phone width; wrap the row rather than let the
     labels break across lines inside a button. */
  .syllabus-action-row { width: 100%; display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
  .syllabus-action-row .mini-btn { white-space: nowrap; }
  .syllabus-item.completed {
    border-color: rgba(122,171,106,0.5);
    background: rgba(122,171,106,0.10);
  }
  .syllabus-item.completed:hover {
    border-color: rgba(122,171,106,0.7);
    background: rgba(122,171,106,0.16);
  }
  .syllabus-item.completed .syllabus-node {
    border-color: rgba(122,171,106,0.5);
  }
  .discover-language.filter-active select {
    border-color: var(--accent);
    color: var(--accent);
    font-weight: 700;
  }
  .filter-lamp {
    position: absolute;
    left: 10px;
    top: 50%;
    width: 8px;
    height: 8px;
    margin-top: -4px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent), 0 0 2px var(--accent);
    animation: filter-lamp-pulse 1.8s ease-in-out infinite;
    z-index: 2;
  }
  .discover-language.filter-active select { padding-left: 26px; }
  @keyframes filter-lamp-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.45; }
  }
  .filter-reset-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 34px;
    padding: 0 12px;
    font-size: 11px;
    font-weight: 700;
    border: 1px solid var(--border-strong);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.2s;
    white-space: nowrap;
  }
  .filter-reset-btn:hover { color: var(--text-primary); border-color: var(--accent); }
`;
