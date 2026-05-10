/**
 * @polychrome/kiosk - drop-in `window.polychrome` for self-hosted demos.
 *
 * Demos can run in three modes:
 *
 *   auto       (default) - if the extension has injected window.polychrome
 *                          before installKiosk() runs, use it. Otherwise
 *                          install the y-websocket kiosk transport.
 *   kiosk                - always install the kiosk transport, even if the
 *                          extension is present.
 *   extension            - wait up to extensionTimeoutMs for the extension
 *                          to inject; if it doesn't, show a "needs extension"
 *                          banner and do nothing else.
 *
 * Override at runtime with `?mode=auto|kiosk|extension` in the URL.
 *
 * Transport: Yjs over WebSocket to wss://demos.yjs.dev (Yjs's free public
 * relay). Each demo gets a different room scope; `?room=<id>` partitions
 * sessions within a scope. Self-host with `npx y-websocket` for production.
 */

import * as Y from 'yjs';

import type { PolyApi } from './api.js';
import { createPolyApi } from './api.js';
import { installOpsPanel } from './ops-panel.js';
import { TrysteroProvider } from './trystero-provider.js';
import { ensureBottomBar } from './bottom-bar.js';

export type { PolyApi, OpLogRecord, SelfInfo } from './api.js';
export { createPolyApi } from './api.js';
export { installOpsPanel } from './ops-panel.js';
export { TrysteroProvider } from './trystero-provider.js';
export { ensureBottomBar } from './bottom-bar.js';

declare global {
  interface Window {
    polychrome?: PolyApi;
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export type KioskMode = 'auto' | 'kiosk' | 'extension';

export interface KioskOptions {
  /** Demo identifier. Different demos use different rooms by default. */
  scope: string;
  /** Default mode if URL has no `?mode=` override. Defaults to 'auto'. */
  mode?: KioskMode;
  /** How long to wait for the extension to inject (mode='extension'). */
  extensionTimeoutMs?: number;
}

/**
 * Trystero appId namespace. Two clients only see each other if they
 * share the same appId AND the same room name. We additionally key
 * the room by demo scope so the drawing room and the choropleth room
 * never collide on the same trackers.
 */
const DEFAULT_APP_ID = 'polychrome';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const COLORS = ['#7c5cff', '#5cffb1', '#ff5c7c', '#ffc857', '#5ccfff'];
const ANIMALS = ['otter', 'lynx', 'fox', 'crane', 'shark', 'wolf', 'puma', 'orca'];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

function randomRoomId(): string {
  return Math.random().toString(36).slice(2, 8);
}

function resolveMode(opts: KioskOptions): KioskMode {
  const url = new URLSearchParams(window.location.search).get('mode') as KioskMode | null;
  if (url === 'auto' || url === 'kiosk' || url === 'extension') return url;
  return opts.mode ?? 'auto';
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export function installKiosk(opts: KioskOptions): void {
  const mode = resolveMode(opts);

  if (mode === 'extension') {
    waitForExtension(opts.extensionTimeoutMs ?? 2000);
    return;
  }

  // 'auto': defer to extension if it injected before us.
  if (mode === 'auto' && window.polychrome) {
    showBadge('connected via extension', 'ok');
    return;
  }

  installKioskTransport(opts);
}

function waitForExtension(timeoutMs: number): void {
  if (window.polychrome) {
    showBadge('connected via extension', 'ok');
    return;
  }
  const t0 = Date.now();
  const id = setInterval(() => {
    if (window.polychrome) {
      clearInterval(id);
      showBadge('connected via extension', 'ok');
      return;
    }
    if (Date.now() - t0 > timeoutMs) {
      clearInterval(id);
      showBadge(
        'PolyChrome extension required - switch to ?mode=kiosk to try without it',
        'warn',
      );
    }
  }, 100);
}

// ---------------------------------------------------------------------------
// Kiosk transport (Yjs over Trystero / public BitTorrent trackers)
// ---------------------------------------------------------------------------

function installKioskTransport(opts: KioskOptions): void {
  const params = new URLSearchParams(window.location.search);
  let room = params.get('room');
  if (!room) {
    room = randomRoomId();
    params.set('room', room);
    history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
  }

  const ydoc = new Y.Doc();
  const provider = new TrysteroProvider(`polychrome-${opts.scope}-${room}`, ydoc, {
    appId: DEFAULT_APP_ID,
  });

  const self = {
    actorId: provider.awareness.clientID.toString(),
    name: pick(ANIMALS),
    color: pick(COLORS),
  };
  provider.awareness.setLocalStateField('user', self);

  // Make sure remote peers stop seeing this tab as soon as it goes away.
  // Trystero leaves the room cleanly, but we additionally null awareness
  // so peers see us drop without waiting for the outdated-state timeout.
  const cleanup = (): void => {
    try {
      provider.awareness.setLocalState(null);
      provider.disconnect();
      provider.destroy();
    } catch {
      // ignore - fired during page close, nothing to recover
    }
  };
  window.addEventListener('pagehide', cleanup);
  window.addEventListener('beforeunload', cleanup);

  const api = createPolyApi(ydoc, self);
  window.polychrome = api;

  installBanner(room, provider, self);
  installOpsPanel(api);
}

// ---------------------------------------------------------------------------
// Banner UI (kiosk mode only)
// ---------------------------------------------------------------------------

function ensureBannerStyles(): void {
  if (document.getElementById('pc-kiosk-styles')) return;
  const css = `
    /* Banner is a child of #pc-kiosk-bottom-bar so it stacks
       horizontally with the ops-panel toggle. */
    #pc-kiosk-banner {
      font: 12px/1.4 -apple-system, system-ui, sans-serif;
      background: rgba(28, 31, 37, 0.95); color: #e8eaed;
      border: 1px solid #2a2e36; border-radius: 10px;
      padding: 8px 12px; backdrop-filter: blur(6px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      display: flex; align-items: center; gap: 10px;
      min-width: 0; max-width: 100%;
    }
    @media (prefers-color-scheme: light) {
      #pc-kiosk-banner {
        background: rgba(255,255,255,0.95); color: #1a1d23;
        border-color: #e1e4e8; box-shadow: 0 2px 12px rgba(0,0,0,0.08);
      }
    }
    #pc-kiosk-banner .pc-dot {
      width: 8px; height: 8px; border-radius: 50%;
      box-shadow: 0 0 0 2px rgba(255,255,255,0.15);
    }
    #pc-kiosk-banner code {
      font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px;
      background: rgba(124,92,255,0.15); padding: 2px 6px; border-radius: 4px;
      color: inherit;
    }
    #pc-kiosk-banner button {
      font: inherit; cursor: pointer; background: #7c5cff; color: white;
      border: none; padding: 4px 10px; border-radius: 6px;
    }
    #pc-kiosk-banner button:hover { background: #9b80ff; }
    #pc-kiosk-banner .pc-peers { font-size: 11px; opacity: 0.7; }
    #pc-kiosk-badge {
      position: fixed; right: 12px; bottom: 12px; z-index: 1000;
      max-width: calc(100vw - 24px);
      font: 12px/1.4 -apple-system, system-ui, sans-serif;
      background: rgba(28, 31, 37, 0.95); color: #e8eaed;
      border: 1px solid #2a2e36; border-radius: 10px;
      padding: 6px 12px; backdrop-filter: blur(6px);
    }
    #pc-kiosk-badge.ok { border-color: #5cffb1; color: #5cffb1; }
    #pc-kiosk-badge.warn { border-color: #ffc857; color: #ffc857; }
    /* Status / peers text wrap and truncate so the banner never blows
       past its row's available width, regardless of how chatty the
       current state is. */
    #pc-kiosk-banner > span {
      min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    @media (max-width: 600px) {
      #pc-kiosk-banner { font-size: 11px; padding: 6px 10px; gap: 6px; }
      #pc-kiosk-banner button { padding: 3px 8px; }
      /* Drop the secondary 'you are X' tag at moderately narrow sizes. */
      #pc-kiosk-banner .pc-peers { display: none; }
    }
    @media (max-width: 460px) {
      /* Compact mode: dot + room code + icon-only Copy button. The
         full status string would push past the viewport otherwise. */
      #pc-kiosk-banner .pc-status { display: none; }
      #pc-kiosk-banner button {
        font-size: 0; padding: 4px 6px;
      }
      #pc-kiosk-banner button::before {
        content: '⧉'; font-size: 13px;
      }
    }
  `;
  const style = document.createElement('style');
  style.id = 'pc-kiosk-styles';
  style.textContent = css;
  document.head.appendChild(style);
}

function showBadge(message: string, kind: 'ok' | 'warn' = 'ok'): void {
  ensureBannerStyles();
  let el = document.getElementById('pc-kiosk-badge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'pc-kiosk-badge';
    document.body.appendChild(el);
  }
  el.className = kind;
  el.textContent = message;
}

function installBanner(
  room: string,
  provider: TrysteroProvider,
  self: { name: string; color: string },
): void {
  ensureBannerStyles();
  const banner = document.createElement('div');
  banner.id = 'pc-kiosk-banner';

  const dot = document.createElement('span');
  dot.className = 'pc-dot';
  dot.style.background = self.color;

  const status = document.createElement('span');
  status.className = 'pc-status';
  status.textContent = 'connecting…';

  const roomCode = document.createElement('code');
  roomCode.textContent = room;

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy invite link';
  copyBtn.addEventListener('click', () => {
    void navigator.clipboard?.writeText(window.location.href);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => (copyBtn.textContent = 'Copy invite link'), 1500);
  });

  const peers = document.createElement('span');
  peers.className = 'pc-peers';

  banner.append(dot, status, roomCode, copyBtn, peers);
  ensureBottomBar().appendChild(banner);

  const myClientId = provider.awareness.clientID;
  // Stale-peer guard: a tab that closed without firing pagehide can leave a
  // ghost awareness entry until the protocol's outdated-state timeout
  // (default 30s) expires. We additionally treat any state whose `user`
  // field is null (cleared on pagehide) as gone.
  const liveCount = (): number => {
    let n = 0;
    for (const [clientId, state] of provider.awareness.getStates()) {
      if (clientId === myClientId) { n++; continue; }
      if (state && (state as { user?: unknown }).user) n++;
    }
    return n;
  };
  /**
   * Trystero abstracts signaling but we still expose two diagnostics:
   *   - signalingConns[0].connected: room joined (Trystero "ready")
   *   - peers.size: number of established WebRTC data channels
   * The banner distinguishes them so a user can tell whether the room
   * never came up vs whether they're alone in it.
   */
  const signalingConnected = (): boolean => {
    type Conn = { connected?: boolean };
    const conns = (provider as unknown as { signalingConns?: Iterable<Conn> }).signalingConns;
    if (!conns) return Boolean((provider as unknown as { connected?: boolean }).connected);
    for (const c of conns) if (c.connected) return true;
    return false;
  };
  const webrtcPeerCount = (): number => {
    const peersField = (provider as unknown as { peers?: Map<unknown, unknown> | unknown[] }).peers;
    if (!peersField) return 0;
    if (peersField instanceof Map) return peersField.size;
    if (Array.isArray(peersField)) return peersField.length;
    return 0;
  };
  const relayState = (): { connected: number; total: number } => {
    const fn = (provider as unknown as { relayState?: () => { connected: number; total: number } }).relayState;
    return fn ? fn.call(provider) : { connected: 0, total: 0 };
  };
  const updateStatus = (): void => {
    const n = liveCount();
    const sigOk = signalingConnected();
    const wrtcN = webrtcPeerCount();
    if (n > 1 || wrtcN > 0) {
      status.textContent = `${Math.max(n - 1, wrtcN)} peer${(n - 1 > 1 || wrtcN > 1) ? 's' : ''} connected`;
      peers.textContent = `· you are ${self.name}`;
    } else if (sigOk) {
      const r = relayState();
      // Show relay state alongside "waiting for a peer" so a user can
      // tell whether the relays are reachable from their network. If
      // 0/N relays are connected, the page can't discover peers.
      const relayLabel = r.total > 0 ? ` · relays ${r.connected}/${r.total}` : '';
      status.textContent = `waiting for a peer${relayLabel}`;
      peers.textContent = '';
    } else {
      status.textContent = 'connecting to signaling…';
      peers.textContent = '';
    }
  };
  const onAwarenessChange = (): void => updateStatus();
  provider.awareness.on('change', onAwarenessChange);
  // Polite poll so the count refreshes after the awareness outdated-state
  // timeout culls stale ghosts.
  const t = setInterval(updateStatus, 1000);
  window.addEventListener('beforeunload', () => clearInterval(t));
  window.addEventListener('pagehide', () => clearInterval(t));
  updateStatus();
}
