/**
 * background/index.ts - PolyChrome MV3 service worker.
 *
 * Single source of truth for:
 *   - identity (actorId, name, color) - generated once on install, persisted
 *     in chrome.storage.local
 *   - the user's currently-active room id (or null = "PolyChrome off")
 *
 * Talks to:
 *   - content scripts via long-lived chrome.runtime.connect ports. Pushes
 *     {type:'state'} on connect and on every room change, so each tab's
 *     bridge picks up the current identity + room without polling.
 *   - the popup via one-shot chrome.runtime.sendMessage requests:
 *       getState, setRoom(room|null), generateRoom
 */

import { newActorId } from '@polychrome/protocol';

import {
  type Identity,
  type RuntimeMessage,
  type RuntimePushMessage,
  type RuntimeStateResponse,
  ROOM_STORAGE_KEY,
  IDENTITY_STORAGE_KEY,
  TAB_IDENTITY_KEY_PREFIX,
  generateRoomId,
  isValidRoomId,
  randomColor,
  randomName,
} from './shared.js';

// ---------------------------------------------------------------------------
// Identity bootstrap
// ---------------------------------------------------------------------------

async function loadOrCreateIdentity(): Promise<Identity> {
  const stored = await chrome.storage.local.get(IDENTITY_STORAGE_KEY);
  const existing = stored[IDENTITY_STORAGE_KEY] as Identity | undefined;
  if (existing && existing.actorId && existing.name && existing.color) {
    return existing;
  }
  const fresh: Identity = {
    actorId: newActorId() as unknown as string,
    name: randomName(),
    color: randomColor(),
  };
  await chrome.storage.local.set({ [IDENTITY_STORAGE_KEY]: fresh });
  return fresh;
}

/**
 * Layer a per-tab `name` + `color` over the browser-wide base
 * identity. Persisted in chrome.storage.session, keyed by tabId, so
 * the persona survives SW restarts but resets when the browser closes
 * - matching the lifetime of a tab. Cleaned up on tabs.onRemoved so a
 * recycled tabId gets a fresh persona rather than inheriting the old
 * tab's.
 *
 * If tabId is undefined (one-shot messages from non-tab contexts),
 * returns the base identity unchanged.
 */
async function loadOrCreateTabIdentity(
  tabId: number | undefined,
  base: Identity,
): Promise<Identity> {
  if (tabId === undefined) return base;
  const key = `${TAB_IDENTITY_KEY_PREFIX}${tabId}`;
  const stored = await chrome.storage.session.get(key);
  const existing = stored[key] as Identity | undefined;
  if (existing && existing.name && existing.color) {
    // Keep actorId in sync with the current base (e.g. if the browser
    // identity was somehow reset, the per-tab entry should follow).
    return { actorId: base.actorId, name: existing.name, color: existing.color };
  }
  const fresh: Identity = {
    actorId: base.actorId,
    name: randomName(),
    color: randomColor(),
  };
  await chrome.storage.session.set({ [key]: fresh });
  return fresh;
}

async function loadRoom(): Promise<string | null> {
  const stored = await chrome.storage.local.get(ROOM_STORAGE_KEY);
  const v = stored[ROOM_STORAGE_KEY];
  return typeof v === 'string' ? v : null;
}

async function setRoom(room: string | null): Promise<void> {
  if (room === null) await chrome.storage.local.remove(ROOM_STORAGE_KEY);
  else await chrome.storage.local.set({ [ROOM_STORAGE_KEY]: room });
}

// ---------------------------------------------------------------------------
// Long-lived ports to content scripts
// ---------------------------------------------------------------------------

const ports = new Set<chrome.runtime.Port>();

/**
 * Push the current state to every connected port. Each port belongs
 * to a tab, so we resolve a per-tab identity per port rather than
 * sharing one message - which is why this isn't a simple
 * `postMessage(msg)` fan-out.
 */
async function broadcastState(): Promise<void> {
  const [base, room] = await Promise.all([loadOrCreateIdentity(), loadRoom()]);
  for (const p of ports) {
    const tabId = p.sender?.tab?.id;
    const identity = await loadOrCreateTabIdentity(tabId, base);
    try { p.postMessage({ type: 'state', identity, room } satisfies RuntimePushMessage); }
    catch { /* port closed - drop */ }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'polychrome') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  const tabId = port.sender?.tab?.id;
  void Promise.all([loadOrCreateIdentity(), loadRoom()]).then(async ([base, room]) => {
    const identity = await loadOrCreateTabIdentity(tabId, base);
    try { port.postMessage({ type: 'state', identity, room } satisfies RuntimePushMessage); }
    catch { /* port closed before we could send */ }
  });
});

// When a tab is closed, drop its per-tab identity entry so a recycled
// tabId starts fresh.
chrome.tabs.onRemoved.addListener((tabId) => {
  void chrome.storage.session.remove(`${TAB_IDENTITY_KEY_PREFIX}${tabId}`);
});

// ---------------------------------------------------------------------------
// One-shot popup messages
// ---------------------------------------------------------------------------

async function handle(msg: RuntimeMessage): Promise<RuntimeStateResponse> {
  const tabId = msg.tabId;
  switch (msg.type) {
    case 'getState': {
      const [base, room] = await Promise.all([loadOrCreateIdentity(), loadRoom()]);
      const identity = await loadOrCreateTabIdentity(tabId, base);
      return { identity, room };
    }
    case 'setRoom': {
      if (msg.room !== null && !isValidRoomId(msg.room)) {
        // Reject silently and return current state.
        const [base, room] = await Promise.all([loadOrCreateIdentity(), loadRoom()]);
        const identity = await loadOrCreateTabIdentity(tabId, base);
        return { identity, room };
      }
      await setRoom(msg.room);
      const [base, room] = await Promise.all([loadOrCreateIdentity(), loadRoom()]);
      const identity = await loadOrCreateTabIdentity(tabId, base);
      void broadcastState();
      return { identity, room };
    }
    case 'generateRoom': {
      const newRoom = generateRoomId();
      await setRoom(newRoom);
      const base = await loadOrCreateIdentity();
      const identity = await loadOrCreateTabIdentity(tabId, base);
      void broadcastState();
      return { identity, room: newRoom };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  void handle(msg).then(sendResponse);
  // Tell Chrome we'll call sendResponse asynchronously.
  return true;
});

// Bootstrap identity on install so the popup never sees a missing one,
// and enable the side panel to open from a generic action click as a
// graceful fallback when the popup-driven open path fails.
chrome.runtime.onInstalled.addListener(() => {
  void loadOrCreateIdentity();
  void chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: false })
    .catch(() => { /* sidePanel API unavailable */ });
});
