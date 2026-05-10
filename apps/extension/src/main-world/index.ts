/**
 * main-world/index.ts - PolyChrome page bridge (MAIN world).
 *
 * Runs in the page's own JS context. Reads the identity + room id the
 * content script wrote onto document.documentElement.dataset, then sets
 * up a Yjs doc + WebrtcProvider and installs createPolyApi() on
 * window.polychrome - so demos that use `window.polychrome` work
 * unchanged whether their runtime is the kiosk or the extension.
 *
 * A MutationObserver watches the dataset.polychromeRoom attribute so a
 * popup-driven room change tears down the old provider and stands a new
 * one up without a page reload.
 */

import * as Y from 'yjs';
import { createPolyApi, ensureBottomBar, installOpsPanel, TrysteroProvider, type PolyApi } from '@polychrome/kiosk';

import { installCursors, type CursorsHandle } from './cursors.js';
import { installScrollSync, type ScrollHandle } from './scroll.js';
import { d3BrushAdapter } from './adapters/d3-brush.js';
import { AdapterRegistry } from './adapters/registry.js';

const adapters = new AdapterRegistry();
adapters.register(d3BrushAdapter);

declare global {
  interface Window {
    polychrome?: PolyApi;
  }
}

interface Identity {
  actorId: string;
  name: string;
  color: string;
}

let active: {
  provider: TrysteroProvider;
  doc: Y.Doc;
  room: string;
  cursors: CursorsHandle;
  scroll: ScrollHandle;
  adapterTeardown: () => void;
  opsPanel: { destroy: () => void };
  badgeTimer: number;
} | null = null;

// ---------------------------------------------------------------------------
// Per-tab identity
// ---------------------------------------------------------------------------
//
// The service worker issues one identity per browser (one actorId, one
// name, one color). Without further tweaking, two tabs of the same
// browser would surface as a single peer in the banner, cursor labels,
// and ops log. We layer a tab-scoped name + color on top of the
// SW-issued identity so each tab looks like its own peer. The base
// actorId is preserved so the op log still groups by author (one
// browser = one author), and Yjs's clientID already distinguishes the
// tabs for cursor rendering.

const TAB_IDENTITY_KEY = 'polychrome.tabIdentity';
const TAB_ANIMALS = [
  'otter', 'lynx', 'fox', 'crane', 'shark', 'wolf', 'puma', 'orca',
  'heron', 'gecko', 'badger', 'falcon', 'mantis', 'koala', 'tapir',
];
const TAB_COLORS = [
  '#7c5cff', '#5cffb1', '#ff5c7c', '#ffc857', '#5ccfff',
  '#ff9f5c', '#ff5cf0', '#a3e635',
];

function pick<T>(arr: readonly T[], fallback: T): T {
  return arr[Math.floor(Math.random() * arr.length)] ?? fallback;
}

/**
 * Layer a per-tab `name` + `color` over the SW-issued identity.
 * Persisted in sessionStorage so a refresh keeps the same tab persona.
 */
function perTabIdentity(base: Identity): Identity {
  try {
    const cached = sessionStorage.getItem(TAB_IDENTITY_KEY);
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<Identity>;
      if (parsed && parsed.name && parsed.color) {
        return { ...base, name: parsed.name, color: parsed.color };
      }
    }
  } catch { /* sessionStorage unavailable - fall through to a fresh roll */ }
  const fresh: Identity = {
    actorId: base.actorId,
    name: pick(TAB_ANIMALS, 'otter'),
    color: pick(TAB_COLORS, '#7c5cff'),
  };
  try { sessionStorage.setItem(TAB_IDENTITY_KEY, JSON.stringify(fresh)); }
  catch { /* ignore - we'll re-roll next applyConfig, which is fine */ }
  return fresh;
}

function readDataset(): { identity: Identity | null; room: string | null } {
  const root = document.documentElement;
  const idJson = root.dataset['polychromeIdentity'];
  const room = root.dataset['polychromeRoom'] ?? null;
  let identity: Identity | null = null;
  if (idJson) {
    try { identity = JSON.parse(idJson) as Identity; } catch { /* invalid */ }
  }
  return { identity, room };
}

function teardown(): void {
  if (!active) return;
  try {
    clearInterval(active.badgeTimer);
    active.opsPanel.destroy();
    active.adapterTeardown();
    active.scroll.destroy();
    active.cursors.destroy();
    active.provider.awareness.setLocalState(null);
    active.provider.disconnect();
    active.provider.destroy();
  } catch { /* ignore - destroy after page unload */ }
  active = null;
}

const BADGE_ID = 'polychrome-extension-badge';

/**
 * The bridge's status badge lives inside the kiosk's shared bottom-bar
 * so it sits next to the ops toggle on the bottom-left (rather than
 * floating on the right corner). Styling matches the ops toggle: same
 * height, same purple accent, same backdrop blur.
 */
function ensureBadge(label: string): void {
  const mount = (): void => {
    if (!document.body) {
      document.addEventListener('DOMContentLoaded', mount, { once: true });
      return;
    }
    const bar = ensureBottomBar(document);
    let el = document.getElementById(BADGE_ID);
    if (!el) {
      el = document.createElement('div');
      el.id = BADGE_ID;
      el.style.cssText = [
        'display:inline-flex', 'align-items:center', 'gap:6px',
        'font:12px/1.4 -apple-system,system-ui,sans-serif',
        'background:rgba(28,31,37,0.95)', 'color:#7c5cff',
        'border:1px solid #7c5cff', 'border-radius:10px',
        'padding:8px 12px', 'backdrop-filter:blur(6px)',
        'box-shadow:0 4px 16px rgba(0,0,0,0.3)',
      ].join(';');
      bar.appendChild(el);
    }
    el.textContent = label;
  };
  mount();
}

function removeBadge(): void {
  document.getElementById(BADGE_ID)?.remove();
}

function applyConfig(): void {
  const { identity: baseIdentity, room } = readDataset();

  // No room or no identity: tear down whatever we had and leave
  // window.polychrome alone (either undefined or whatever the page
  // installed itself, e.g. the kiosk).
  if (!baseIdentity || !room) {
    teardown();
    removeBadge();
    return;
  }

  // Same room as before? Nothing to do.
  if (active && active.room === room) return;

  teardown();

  // Each tab gets its own visible name + color (persisted in
  // sessionStorage). Two tabs of the same browser then show up as two
  // distinct peers in the banner, cursor labels, and ops log.
  const identity = perTabIdentity(baseIdentity);

  const doc = new Y.Doc();
  const provider = new TrysteroProvider(`polychrome-extension-${room}`, doc, {
    appId: 'polychrome',
  });
  provider.awareness.setLocalStateField('user', identity);

  const api = createPolyApi(doc, identity);
  window.polychrome = api;
  const cursors = installCursors({
    awareness: provider.awareness,
    self: identity,
  });
  const scroll = installScrollSync({ api });
  const adapterTeardown = adapters.install(new URL(window.location.href), {
    api,
    self: identity,
    log: () => { /* replaced in registry */ },
    warn: () => { /* replaced in registry */ },
  });

  // Mount the same ops panel kiosk demos use, so the user can see
  // every share/list/checkpoint op flowing through (incl. brush
  // mirrors). It's a collapsed pill in the bottom-right by default.
  const opsPanel = installOpsPanel(api);

  // Live badge: room id + peer count, ticks 1Hz off the provider.
  const updateBadge = (): void => {
    if (!active) return;
    const peers = active.provider.peers.size;
    const label =
      peers === 0
        ? `PolyChrome · ${room} · waiting for a peer`
        : `PolyChrome · ${room} · ${peers} peer${peers > 1 ? 's' : ''}`;
    ensureBadge(label);
  };
  const badgeTimer = window.setInterval(updateBadge, 1000);

  active = { provider, doc, room, cursors, scroll, adapterTeardown, opsPanel, badgeTimer };
  updateBadge();
}

// ---------------------------------------------------------------------------
// Initial apply + observe dataset changes from the content script.
// ---------------------------------------------------------------------------

applyConfig();

const observer = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (
      m.type === 'attributes' &&
      (m.attributeName === 'data-polychrome-room' ||
       m.attributeName === 'data-polychrome-identity')
    ) {
      applyConfig();
      return;
    }
  }
});
observer.observe(document.documentElement, {
  attributes: true,
  attributeFilter: ['data-polychrome-room', 'data-polychrome-identity'],
});

window.addEventListener('pagehide', teardown);
window.addEventListener('beforeunload', teardown);
