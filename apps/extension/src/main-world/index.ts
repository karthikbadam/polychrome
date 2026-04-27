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
import { createPolyApi, TrysteroProvider, type PolyApi } from '@polychrome/kiosk';

import { installCursors, type CursorsHandle } from './cursors.js';
import { mosaicAdapter } from './adapters/mosaic.js';
import { AdapterRegistry } from './adapters/registry.js';

const adapters = new AdapterRegistry();
adapters.register(mosaicAdapter);

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
  adapterTeardown: () => void;
} | null = null;

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
    active.adapterTeardown();
    active.cursors.destroy();
    active.provider.awareness.setLocalState(null);
    active.provider.disconnect();
    active.provider.destroy();
  } catch { /* ignore - destroy after page unload */ }
  active = null;
}

function ensureBadge(label: string): void {
  let el = document.getElementById('polychrome-extension-badge');
  if (!el) {
    el = document.createElement('div');
    el.id = 'polychrome-extension-badge';
    el.style.cssText = [
      'position:fixed', 'right:12px', 'bottom:12px', 'z-index:1000',
      'font:12px/1.4 -apple-system,system-ui,sans-serif',
      'background:rgba(28,31,37,0.95)', 'color:#5cffb1',
      'border:1px solid #5cffb1', 'border-radius:10px',
      'padding:6px 12px', 'pointer-events:none',
    ].join(';');
    (document.body ?? document.documentElement).appendChild(el);
  }
  el.textContent = label;
}

function removeBadge(): void {
  document.getElementById('polychrome-extension-badge')?.remove();
}

function applyConfig(): void {
  const { identity, room } = readDataset();

  // No room or no identity: tear down whatever we had and leave
  // window.polychrome alone (either undefined or whatever the page
  // installed itself, e.g. the kiosk).
  if (!identity || !room) {
    teardown();
    removeBadge();
    return;
  }

  // Same room as before? Nothing to do.
  if (active && active.room === room) return;

  teardown();

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
  const adapterTeardown = adapters.install(new URL(window.location.href), {
    api,
    self: identity,
    log: () => { /* replaced in registry */ },
    warn: () => { /* replaced in registry */ },
  });
  active = { provider, doc, room, cursors, adapterTeardown };
  ensureBadge(`PolyChrome - room ${room}`);
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
