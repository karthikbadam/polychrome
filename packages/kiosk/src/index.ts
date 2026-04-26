/**
 * @polychrome/kiosk — drop-in `window.polychrome` for self-hosted demos.
 *
 * Demos can run in three modes:
 *
 *   auto       (default) — if the extension has injected window.polychrome
 *                          before installKiosk() runs, use it. Otherwise
 *                          install the y-websocket kiosk transport.
 *   kiosk                — always install the kiosk transport, even if the
 *                          extension is present.
 *   extension            — wait up to extensionTimeoutMs for the extension
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
import { WebrtcProvider } from 'y-webrtc';

// ---------------------------------------------------------------------------
// API contract (mirrors @polychrome/sdk)
// ---------------------------------------------------------------------------

interface PolyApi {
  share<T>(key: string, initial?: T): {
    get(): T;
    set(value: T): void;
    subscribe(cb: (value: T) => void): () => void;
  };
  list<T>(listId: string): {
    get(): T[];
    insert(index: number, value: T): void;
    delete(index: number): void;
    subscribe(cb: (items: T[]) => void): () => void;
  };
  checkpoint(label: string): void;
  self: { actorId: string; name: string; color: string };
}

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
  /**
   * y-webrtc signaling servers. Defaults to community-run servers. Override
   * for self-hosted deployments.
   */
  signaling?: string[];
  /** How long to wait for the extension to inject (mode='extension'). */
  extensionTimeoutMs?: number;
}

const DEFAULT_SIGNALING = [
  'wss://signaling.yjs.dev',
  'wss://y-webrtc-eu.fly.dev',
];

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
        'PolyChrome extension required — switch to ?mode=kiosk to try without it',
        'warn',
      );
    }
  }, 100);
}

// ---------------------------------------------------------------------------
// Kiosk transport (Yjs over y-websocket)
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
  const provider = new WebrtcProvider(`polychrome-${opts.scope}-${room}`, ydoc, {
    signaling: opts.signaling ?? DEFAULT_SIGNALING,
    // Use Cloudflare's public STUN servers for NAT traversal.
    peerOpts: {
      config: {
        iceServers: [
          { urls: 'stun:stun.cloudflare.com:3478' },
          { urls: 'stun:stun.l.google.com:19302' },
        ],
      },
    },
  });

  const yKeys = ydoc.getMap<unknown>('keys');

  const self = {
    actorId: provider.awareness.clientID.toString(),
    name: pick(ANIMALS),
    color: pick(COLORS),
  };
  provider.awareness.setLocalStateField('user', self);

  // ydoc.getArray(name) is idempotent and returns the SAME Y.Array across
  // peers/calls — that's the correct way to share a nested type. The
  // earlier impl wrapped Y.Array values inside a Y.Map, which produced a
  // race: each peer constructed its own Y.Array on first call, and CRDT
  // last-writer-wins discarded all but one — so the other peer kept
  // inserting into an orphaned, never-synced array.
  function getList(listId: string): Y.Array<unknown> {
    return ydoc.getArray<unknown>(`list:${listId}`);
  }

  const api: PolyApi = {
    self,

    share<T>(key: string, initial?: T) {
      // Seed once after a short delay to let any peer-state sync arrive
      // first. Y.Map's CRDT semantics are last-writer-wins per key, so even
      // if multiple late-joiners seed concurrently they converge.
      if (initial !== undefined) {
        setTimeout(() => {
          if (!yKeys.has(key)) yKeys.set(key, initial as unknown);
        }, 500);
      }
      return {
        get: (): T => yKeys.get(key) as T,
        set: (value: T): void => { yKeys.set(key, value as unknown); },
        subscribe(cb: (value: T) => void): () => void {
          const obs = (e: Y.YMapEvent<unknown>): void => {
            if (e.keysChanged.has(key)) cb(yKeys.get(key) as T);
          };
          yKeys.observe(obs);
          if (yKeys.has(key)) cb(yKeys.get(key) as T);
          return () => yKeys.unobserve(obs);
        },
      };
    },

    list<T>(listId: string) {
      const arr = getList(listId);
      return {
        get: (): T[] => arr.toArray() as T[],
        insert: (index: number, value: T): void => arr.insert(index, [value]),
        delete: (index: number): void => arr.delete(index, 1),
        subscribe(cb: (items: T[]) => void): () => void {
          const obs = (): void => cb(arr.toArray() as T[]);
          arr.observe(obs);
          cb(arr.toArray() as T[]);
          return () => arr.unobserve(obs);
        },
      };
    },

    checkpoint(label: string): void {
      console.log('[polychrome] checkpoint:', label);
      const arr = getList('checkpoints');
      arr.push([{ at: Date.now(), label, by: self.name }]);
    },
  };

  window.polychrome = api;

  installBanner(room, provider, self);
}

// ---------------------------------------------------------------------------
// Banner UI (kiosk mode only)
// ---------------------------------------------------------------------------

function ensureBannerStyles(): void {
  if (document.getElementById('pc-kiosk-styles')) return;
  const css = `
    #pc-kiosk-banner {
      position: fixed; left: 12px; bottom: 12px; z-index: 1000;
      max-width: calc(100vw - 24px);
      font: 12px/1.4 -apple-system, system-ui, sans-serif;
      background: rgba(28, 31, 37, 0.95); color: #e8eaed;
      border: 1px solid #2a2e36; border-radius: 10px;
      padding: 8px 12px; backdrop-filter: blur(6px);
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
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
    @media (max-width: 480px) {
      #pc-kiosk-banner { font-size: 11px; padding: 6px 10px; gap: 6px; }
      #pc-kiosk-banner button { padding: 3px 8px; }
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
  provider: WebrtcProvider,
  self: { name: string; color: string },
): void {
  ensureBannerStyles();
  const banner = document.createElement('div');
  banner.id = 'pc-kiosk-banner';

  const dot = document.createElement('span');
  dot.className = 'pc-dot';
  dot.style.background = self.color;

  const status = document.createElement('span');
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
  document.body.appendChild(banner);

  const updateStatus = (): void => {
    // Awareness reports every connected client (including self).
    const n = provider.awareness.getStates().size;
    if (n > 1) {
      status.textContent = `${n - 1} peer${n > 2 ? 's' : ''} connected`;
      peers.textContent = `· you are ${self.name}`;
    } else {
      status.textContent = 'waiting for a peer';
      peers.textContent = '';
    }
  };
  provider.awareness.on('change', updateStatus);
  // Polite poll in case awareness 'change' didn't fire on initial connect.
  const t = setInterval(updateStatus, 1000);
  window.addEventListener('beforeunload', () => clearInterval(t));
  updateStatus();
}
