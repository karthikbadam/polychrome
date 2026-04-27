/**
 * ops-panel.ts - in-page panel that lists every entry in the
 * polychrome:oplog and lets the user click to inspect.
 *
 * The panel is toggle-able and collapsed by default so it doesn't
 * cover the demo's UI. It auto-updates as new ops arrive.
 *
 * Decoupled from the transport: takes a PolyApi and reads
 * `api.history`, so it works for any backend that wires up
 * createPolyApi.
 */

import type { OpLogRecord, PolyApi } from './api.js';

export interface OpsPanelHandle {
  destroy(): void;
  /** Expand or collapse the panel programmatically. */
  setOpen(open: boolean): void;
  readonly isOpen: boolean;
}

const PANEL_ID = 'pc-ops-panel';
const STYLE_ID = 'pc-ops-panel-styles';

export function installOpsPanel(api: PolyApi, hostDoc: Document = document): OpsPanelHandle {
  ensureStyles(hostDoc);

  const wrapper = hostDoc.createElement('div');
  wrapper.id = PANEL_ID;
  wrapper.dataset['open'] = 'false';
  wrapper.innerHTML = `
    <div class="pc-ops-body" role="region" aria-label="PolyChrome operations log">
      <header>
        <span class="pc-ops-title">Operations</span>
        <span class="pc-ops-meta"></span>
      </header>
      <ol class="pc-ops-list" role="list"></ol>
      <footer>
        <span class="pc-ops-hint">click any row to inspect; latest at top</span>
      </footer>
    </div>
    <button class="pc-ops-toggle" type="button" aria-expanded="false">
      <span class="pc-ops-toggle-icon">⟨/⟩</span>
      <span class="pc-ops-toggle-label">ops</span>
      <span class="pc-ops-count">0</span>
    </button>
  `;
  hostDoc.body.appendChild(wrapper);

  const toggle = wrapper.querySelector('.pc-ops-toggle') as HTMLButtonElement;
  const body = wrapper.querySelector('.pc-ops-body') as HTMLElement;
  const list = wrapper.querySelector('.pc-ops-list') as HTMLOListElement;
  const countEl = wrapper.querySelector('.pc-ops-count') as HTMLSpanElement;
  const metaEl = wrapper.querySelector('.pc-ops-meta') as HTMLSpanElement;

  let isOpen = false;
  let expandedIndex: number | null = null;
  let lastRecords: readonly OpLogRecord[] = [];

  function setOpen(open: boolean): void {
    isOpen = open;
    wrapper.dataset['open'] = String(open);
    toggle.setAttribute('aria-expanded', String(open));
    body.style.display = open ? 'flex' : 'none';
  }
  setOpen(false);

  toggle.addEventListener('click', () => setOpen(!isOpen));

  function render(records: readonly OpLogRecord[]): void {
    lastRecords = records;
    countEl.textContent = String(records.length);
    metaEl.textContent = records.length === 0
      ? 'no ops yet'
      : `${records.length} total`;

    // Render newest first, cap at 200 rows so the DOM doesn't grow
    // unboundedly during long sessions.
    const display = records.slice(-200).map((r, i) => ({ r, i: records.length - 1 - (records.slice(-200).length - 1 - i) }));
    list.replaceChildren();
    for (const { r, i } of display.reverse()) {
      const li = hostDoc.createElement('li');
      li.className = 'pc-ops-item';
      li.dataset['index'] = String(i);
      const expanded = i === expandedIndex;
      li.setAttribute('aria-expanded', String(expanded));
      li.innerHTML = `
        <div class="pc-ops-row">
          <span class="pc-ops-dot" style="background:${escapeAttr(r.byColor)}"></span>
          <span class="pc-ops-kind">${escapeHtml(r.kind)}</span>
          <span class="pc-ops-summary">${escapeHtml(summarize(r))}</span>
          <span class="pc-ops-by">${escapeHtml(r.byName)}</span>
          <span class="pc-ops-time">${escapeHtml(formatTime(r.at))}</span>
        </div>
        ${expanded ? `<pre class="pc-ops-details">${escapeHtml(JSON.stringify(r, null, 2))}</pre>` : ''}
      `;
      li.addEventListener('click', () => {
        expandedIndex = expandedIndex === i ? null : i;
        render(lastRecords);
      });
      list.appendChild(li);
    }
  }

  const off = api.history.subscribe(render);

  return {
    destroy() { off(); wrapper.remove(); },
    setOpen,
    get isOpen() { return isOpen; },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function summarize(r: OpLogRecord): string {
  switch (r.kind) {
    case 'state_set':   return `${r.key} = ${truncate(JSON.stringify(r.value))}`;
    case 'list_insert': return `${r.listId}[${r.index}] += ${truncate(JSON.stringify(r.value))}`;
    case 'list_delete': return `${r.listId}[${r.index}] removed`;
    case 'checkpoint':  return r.label;
    default: { const _x: never = r; void _x; return 'unknown'; }
  }
}

function truncate(s: string, n = 40): string {
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

function formatTime(ms: number): string {
  const delta = Date.now() - ms;
  const sec = Math.round(delta / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}
function escapeAttr(s: string): string { return escapeHtml(s); }

function ensureStyles(doc: Document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    /* Pinned next to the kiosk connection banner at the bottom; body
       opens upward so the toggle button stays aligned with the banner. */
    #${PANEL_ID} {
      position: fixed; right: 12px; bottom: 12px; z-index: 1001;
      display: flex; flex-direction: column; align-items: flex-end;
      font: 12px/1.4 -apple-system, system-ui, sans-serif;
      color: #e8eaed;
    }
    @media (prefers-color-scheme: light) { #${PANEL_ID} { color: #1a1d23; } }

    #${PANEL_ID} .pc-ops-toggle {
      display: inline-flex; align-items: center; gap: 6px;
      font: inherit; cursor: pointer;
      background: rgba(28, 31, 37, 0.92); color: inherit;
      border: 1px solid #2a2e36; border-radius: 8px;
      padding: 5px 10px; backdrop-filter: blur(6px);
      box-shadow: 0 2px 12px rgba(0,0,0,0.3);
    }
    @media (prefers-color-scheme: light) {
      #${PANEL_ID} .pc-ops-toggle {
        background: rgba(255,255,255,0.95); border-color: #e1e4e8;
        box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      }
    }
    #${PANEL_ID} .pc-ops-toggle:hover { border-color: #7c5cff; }
    #${PANEL_ID} .pc-ops-toggle-icon { color: #7c5cff; font-weight: 600; }
    #${PANEL_ID} .pc-ops-count {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 11px; padding: 1px 6px; border-radius: 4px;
      background: rgba(124,92,255,0.15); color: #7c5cff;
    }

    #${PANEL_ID} .pc-ops-body {
      margin-bottom: 6px; flex-direction: column;
      width: min(420px, calc(100vw - 24px));
      max-height: min(60vh, 480px);
      background: rgba(22, 24, 28, 0.96); color: inherit;
      border: 1px solid #2a2e36; border-radius: 10px;
      backdrop-filter: blur(8px);
      box-shadow: 0 12px 32px rgba(0,0,0,0.4);
      overflow: hidden;
    }
    @media (prefers-color-scheme: light) {
      #${PANEL_ID} .pc-ops-body {
        background: rgba(255,255,255,0.97); border-color: #e1e4e8;
        box-shadow: 0 12px 32px rgba(0,0,0,0.08);
      }
    }
    #${PANEL_ID} .pc-ops-body header,
    #${PANEL_ID} .pc-ops-body footer {
      padding: 8px 12px; display: flex; justify-content: space-between;
      align-items: center; border-bottom: 1px solid #2a2e36;
      flex-shrink: 0;
    }
    #${PANEL_ID} .pc-ops-body footer { border-bottom: none; border-top: 1px solid #2a2e36; }
    @media (prefers-color-scheme: light) {
      #${PANEL_ID} .pc-ops-body header,
      #${PANEL_ID} .pc-ops-body footer { border-color: #e1e4e8; }
    }
    #${PANEL_ID} .pc-ops-title { font-weight: 600; font-size: 12px; }
    #${PANEL_ID} .pc-ops-meta,
    #${PANEL_ID} .pc-ops-hint { font-size: 11px; opacity: 0.6; }

    #${PANEL_ID} .pc-ops-list {
      list-style: none; margin: 0; padding: 4px 0;
      overflow-y: auto; flex: 1;
    }
    #${PANEL_ID} .pc-ops-item {
      cursor: pointer; padding: 6px 12px;
    }
    #${PANEL_ID} .pc-ops-item:hover { background: rgba(124,92,255,0.08); }
    #${PANEL_ID} .pc-ops-item[aria-expanded="true"] {
      background: rgba(124,92,255,0.10);
    }
    #${PANEL_ID} .pc-ops-row {
      display: grid;
      grid-template-columns: auto auto 1fr auto auto;
      gap: 8px; align-items: center;
    }
    #${PANEL_ID} .pc-ops-dot {
      width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
    }
    #${PANEL_ID} .pc-ops-kind {
      font-family: ui-monospace, SFMono-Regular, monospace;
      font-size: 11px; color: #7c5cff;
    }
    #${PANEL_ID} .pc-ops-summary {
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px;
    }
    #${PANEL_ID} .pc-ops-by, #${PANEL_ID} .pc-ops-time {
      font-size: 10px; opacity: 0.7;
    }
    #${PANEL_ID} .pc-ops-details {
      margin: 6px 0 0; padding: 8px 10px;
      background: rgba(0,0,0,0.30); color: inherit;
      border-radius: 6px;
      font-family: ui-monospace, SFMono-Regular, monospace; font-size: 10.5px;
      max-height: 240px; overflow: auto;
      white-space: pre-wrap; word-break: break-word;
    }
    @media (prefers-color-scheme: light) {
      #${PANEL_ID} .pc-ops-details { background: #f6f7f9; }
    }
  `;
  doc.head.appendChild(style);
}
