/**
 * popup/index.ts - tiny UI for picking the active PolyChrome room.
 *
 * The popup is tab-specific: it shows the active tab's per-tab
 * identity (name + color) and gives commands that scope to that tab's
 * SW state. Below that, it renders a "live in other tabs" dashboard
 * of every other tab currently reporting in via the SW. Sync between
 * tabs is partitioned by (room, url) so two tabs on different pages
 * don't crosstalk even if they share a room id.
 */

import './style.css';
import type {
  RuntimeMessage,
  RuntimeStateResponse,
  RuntimeTabsResponse,
  TabSummary,
} from '../../background/shared.js';

async function activeTabId(): Promise<number | undefined> {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0]?.id;
}

async function send<T = RuntimeStateResponse>(msg: RuntimeMessage): Promise<T> {
  // The SW resolves per-tab identity by tabId. Without it the popup
  // would render the browser-wide base identity while the page bridge
  // shows its tab-scoped persona - and the two would visibly disagree.
  const tabId = msg.tabId ?? await activeTabId();
  const enriched: RuntimeMessage = tabId === undefined ? msg : { ...msg, tabId };
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(enriched, (response: T) => resolve(response));
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

function renderOtherTabs(tabs: TabSummary[], currentTabId: number | undefined): string {
  const others = tabs.filter((t) => t.tabId !== currentTabId);
  if (others.length === 0) return '';
  const rows = others.map((t) => `
    <div class="tab-row">
      <span class="dot" style="background:${escapeHtml(t.identity.color)}"></span>
      <div class="col">
        <div class="row-name">${escapeHtml(t.identity.name)} <span class="muted">· ${escapeHtml(t.room)}</span></div>
        <div class="row-host" title="${escapeHtml(t.url)}">${escapeHtml(t.hostname || t.url)}</div>
      </div>
      <span class="peers">${t.peerCount} ${t.peerCount === 1 ? 'peer' : 'peers'}</span>
    </div>
  `).join('');
  return `
    <div class="section-label">Also live in ${others.length} ${others.length === 1 ? 'tab' : 'tabs'}</div>
    <div class="tabs-list">${rows}</div>
  `;
}

function render(state: RuntimeStateResponse, tabs: TabSummary[], currentTabId: number | undefined): void {
  const root = document.getElementById('root')!;
  const inRoom = state.room !== null;
  root.innerHTML = `
    <div class="card">
      <div class="who">
        <span class="dot" style="background:${escapeHtml(state.identity.color)}"></span>
        <div>
          <div class="muted">You are (this tab)</div>
          <div class="name">${escapeHtml(state.identity.name)}</div>
        </div>
        <button class="link" id="open-panel" title="Open side panel">↗</button>
      </div>
      ${inRoom ? `
        <div class="room-row">
          <div class="muted">Active room</div>
          <code class="room">${escapeHtml(state.room ?? '')}</code>
        </div>
        <div class="actions">
          <button class="btn primary" id="copy">Copy invite</button>
          <button class="btn" id="leave">Leave</button>
        </div>
      ` : `
        <div class="muted center">Not in a room.</div>
        <div class="actions stack">
          <button class="btn primary" id="newroom">Start new room</button>
          <div class="join-row">
            <input id="joinid" placeholder="join code" maxlength="16" autocomplete="off" />
            <button class="btn" id="join">Join</button>
          </div>
        </div>
      `}
      ${renderOtherTabs(tabs, currentTabId)}
    </div>
  `;

  document.getElementById('open-panel')?.addEventListener('click', async () => {
    const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (tab?.windowId !== undefined) {
      try { await chrome.sidePanel.open({ windowId: tab.windowId }); window.close(); }
      catch { /* user gesture lost; ignore */ }
    }
  });

  if (inRoom) {
    document.getElementById('copy')!.addEventListener('click', () => {
      void navigator.clipboard.writeText(state.room ?? '');
      const btn = document.getElementById('copy') as HTMLButtonElement | null;
      if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = 'Copy invite'; }, 1200); }
    });
    document.getElementById('leave')!.addEventListener('click', async () => {
      await refresh({ type: 'setRoom', room: null });
    });
  } else {
    document.getElementById('newroom')!.addEventListener('click', async () => {
      await refresh({ type: 'generateRoom' });
    });
    const input = document.getElementById('joinid') as HTMLInputElement;
    const join = async (): Promise<void> => {
      const v = input.value.trim().toLowerCase();
      if (!v) return;
      await refresh({ type: 'setRoom', room: v });
    };
    document.getElementById('join')!.addEventListener('click', () => { void join(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void join();
    });
    input.focus();
  }
}

async function refresh(action?: RuntimeMessage): Promise<void> {
  const tabId = await activeTabId();
  const withTab = <M extends RuntimeMessage>(m: M): M =>
    tabId === undefined ? m : { ...m, tabId };
  const state = action
    ? await send<RuntimeStateResponse>(withTab(action))
    : await send<RuntimeStateResponse>(withTab({ type: 'getState' }));
  const { tabs } = await send<RuntimeTabsResponse>(withTab({ type: 'getTabs' }));
  render(state, tabs, tabId);
}

void refresh();
// Keep the dashboard live while the popup is open. Re-fetches every
// 1.5s; cheap because the SW just walks its in-memory map.
setInterval(() => { void refresh(); }, 1500);
