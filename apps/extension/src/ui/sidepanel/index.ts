/**
 * sidepanel/index.ts - PolyChrome side panel.
 *
 * Lives in chrome:// context, so it has full DOM + module imports. We
 * reuse the SW's identity/room state via runtime port and additionally
 * join the y-webrtc room ourselves to display live peer awareness and
 * the checkpoints list.
 *
 * Counting peers: awareness reports one entry per (peer-process, tab).
 * We dedupe by `user.actorId` so two tabs of the same user count as one
 * person. The local awareness entry is annotated with `viewer:'panel'`
 * so we can prefer the demo-tab entry for the same actor when picking
 * a representative.
 */

import './style.css';
import * as Y from 'yjs';
import { createTimeline, type TimelineHandle, type TimelineEvent } from '@polychrome/replay-player';
import { createPolyApi, TrysteroProvider, type OpLogRecord, type PolyApi } from '@polychrome/kiosk';

import type {
  Identity,
  RuntimeMessage,
  RuntimePushMessage,
  RuntimeStateResponse,
} from '../../background/shared.js';

let activeRoom: string | null = null;
let activeIdentity: Identity | null = null;
let provider: TrysteroProvider | null = null;
let doc: Y.Doc | null = null;
let api: PolyApi | null = null;
let unsubHistory: (() => void) | null = null;
let timeline: TimelineHandle | null = null;

function send(msg: RuntimeMessage): Promise<RuntimeStateResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (response: RuntimeStateResponse) => resolve(response));
  });
}

// ---------------------------------------------------------------------------
// Connection: stand up when in a room, tear down when not.
// ---------------------------------------------------------------------------

function connectToRoom(room: string, identity: Identity): void {
  if (provider && activeRoom === room && activeIdentity?.actorId === identity.actorId) return;
  disconnect();

  const d = new Y.Doc();
  const p = new TrysteroProvider(`polychrome-extension-${room}`, d, {
    appId: 'polychrome',
  });
  p.awareness.setLocalStateField('user', { ...identity, viewer: 'panel' });

  p.awareness.on('change', renderPeers);

  const a = createPolyApi(d, identity);
  unsubHistory = a.history.subscribe(renderHistory);

  provider = p;
  doc = d;
  api = a;
  activeRoom = room;
  activeIdentity = identity;
  renderPeers();
}

function disconnect(): void {
  if (timeline) { timeline.destroy(); timeline = null; }
  if (unsubHistory) { unsubHistory(); unsubHistory = null; }
  if (!provider) return;
  try {
    provider.awareness.setLocalState(null);
    provider.disconnect();
    provider.destroy();
  } catch { /* ignore - destroy after page unload */ }
  provider = null;
  doc = null;
  api = null;
  activeRoom = null;
  activeIdentity = null;
}

window.addEventListener('beforeunload', disconnect);

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c] ?? c));
}

function renderShell(state: RuntimeStateResponse): void {
  const root = document.getElementById('root')!;
  const inRoom = state.room !== null;
  root.innerHTML = `
    <header>
      <h1>PolyChrome <span class="ver">2.0</span></h1>
    </header>
    <main>
      <section id="me">
        <h2>You</h2>
        <div class="identity">
          <span class="dot" style="background:${escapeHtml(state.identity.color)}"></span>
          <div>
            <div class="name">${escapeHtml(state.identity.name)}</div>
            <div class="actor">${escapeHtml(state.identity.actorId.slice(0, 8))}</div>
          </div>
        </div>
      </section>

      <section id="room-section">
        <h2>Room</h2>
        ${inRoom ? `
          <div class="room-row">
            <code class="room">${escapeHtml(state.room ?? '')}</code>
          </div>
          <div class="actions">
            <button class="btn primary" id="copy">Copy invite</button>
            <button class="btn danger" id="leave">Leave</button>
          </div>
        ` : `
          <div class="no-room">Not in a room.</div>
          <div class="actions stack">
            <button class="btn primary" id="newroom">Start new room</button>
            <div class="join-row">
              <input id="joinid" placeholder="join code" maxlength="16" autocomplete="off" />
              <button class="btn" id="join">Join</button>
            </div>
          </div>
        `}
      </section>

      <section id="peers-section" style="${inRoom ? '' : 'display:none'}">
        <h2 id="peers-heading">Peers</h2>
        <ul class="peers" id="peers"><li class="empty">connecting&hellip;</li></ul>
      </section>

      <section id="checkpoints-section" style="${inRoom ? '' : 'display:none'}">
        <div class="section-head">
          <h2>History</h2>
          <button class="btn small" id="undo-last" disabled title="Undo your most recent change">Undo last</button>
        </div>
        <div id="timeline-host"></div>
      </section>
    </main>
  `;

  if (inRoom) {
    document.getElementById('copy')!.addEventListener('click', () => {
      void navigator.clipboard.writeText(state.room ?? '');
      const btn = document.getElementById('copy') as HTMLButtonElement | null;
      if (btn) {
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy invite'; }, 1200);
      }
    });
    document.getElementById('leave')!.addEventListener('click', async () => {
      await send({ type: 'setRoom', room: null });
    });
    document.getElementById('undo-last')?.addEventListener('click', () => {
      if (api && activeIdentity) api.history.undoLastBy(activeIdentity.actorId);
    });
  } else {
    document.getElementById('newroom')!.addEventListener('click', async () => {
      await send({ type: 'generateRoom' });
    });
    const input = document.getElementById('joinid') as HTMLInputElement;
    const join = async (): Promise<void> => {
      const v = input.value.trim().toLowerCase();
      if (!v) return;
      await send({ type: 'setRoom', room: v });
    };
    document.getElementById('join')!.addEventListener('click', () => { void join(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') void join(); });
  }
}

function renderPeers(): void {
  const ul = document.getElementById('peers');
  const heading = document.getElementById('peers-heading');
  if (!ul || !provider) return;

  const byActor = new Map<string, { identity: Identity; isSelf: boolean; isPanelOnly: boolean }>();
  for (const [, state] of provider.awareness.getStates()) {
    const u = state ? (state as { user?: Identity & { viewer?: string } }).user : undefined;
    if (!u || !u.actorId) continue;
    const isPanel = u.viewer === 'panel';
    const isSelf = u.actorId === activeIdentity?.actorId;
    const existing = byActor.get(u.actorId);
    if (existing) {
      // Prefer the non-panel entry as the representative when both exist.
      if (existing.isPanelOnly && !isPanel) {
        byActor.set(u.actorId, { identity: u, isSelf, isPanelOnly: false });
      }
    } else {
      byActor.set(u.actorId, { identity: u, isSelf, isPanelOnly: isPanel });
    }
  }

  const peers = [...byActor.values()].sort((a, b) => Number(b.isSelf) - Number(a.isSelf));
  if (heading) heading.textContent = `Peers (${peers.length})`;

  if (peers.length === 0) {
    ul.innerHTML = '<li class="empty">no peers</li>';
    return;
  }
  ul.innerHTML = peers.map(p => `
    <li${p.isSelf ? ' class="self"' : ''}>
      <span class="dot" style="background:${escapeHtml(p.identity.color)}"></span>
      <span class="name">${escapeHtml(p.identity.name)}</span>
      ${p.isSelf ? '<span class="you">you</span>' : ''}
    </li>
  `).join('');
}

function describeOp(r: OpLogRecord): string {
  switch (r.kind) {
    case 'state_set':   return `set ${r.key}`;
    case 'list_insert': return `insert in ${r.listId}`;
    case 'list_delete': return `delete from ${r.listId}`;
    case 'checkpoint':  return r.label;
    default: { const _x: never = r; void _x; return 'unknown'; }
  }
}

function renderHistory(records: readonly OpLogRecord[]): void {
  const host = document.getElementById('timeline-host');
  if (!host) return;

  const items: TimelineEvent[] = records.map(r => ({
    at: r.at,
    label: describeOp(r),
    by: r.byName,
    color: r.byColor,
  }));

  if (timeline) {
    timeline.update({ events: items });
  } else {
    timeline = createTimeline(host as HTMLElement, { events: items });
  }

  // Enable / disable the "Undo last (yours)" button based on whether
  // the local actor has any non-checkpoint ops in the log.
  const btn = document.getElementById('undo-last') as HTMLButtonElement | null;
  if (btn) {
    const me = activeIdentity?.actorId;
    btn.disabled = !records.some(r => r.by === me && r.kind !== 'checkpoint');
  }
}

// ---------------------------------------------------------------------------
// SW state subscription
// ---------------------------------------------------------------------------

function applyState(state: RuntimeStateResponse): void {
  renderShell(state);
  if (state.room) connectToRoom(state.room, state.identity);
  else disconnect();
}

function connect(): void {
  const port = chrome.runtime.connect({ name: 'polychrome' });
  port.onMessage.addListener((msg: RuntimePushMessage) => {
    if (msg.type === 'state') applyState({ identity: msg.identity, room: msg.room });
  });
  port.onDisconnect.addListener(() => setTimeout(connect, 250));
}
connect();
