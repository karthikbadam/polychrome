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

function broadcast(msg: RuntimePushMessage): void {
  for (const p of ports) {
    try { p.postMessage(msg); } catch { /* port closed - drop */ }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'polychrome') return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  void Promise.all([loadOrCreateIdentity(), loadRoom()]).then(([identity, room]) => {
    try { port.postMessage({ type: 'state', identity, room } satisfies RuntimePushMessage); }
    catch { /* port closed before we could send */ }
  });
});

// ---------------------------------------------------------------------------
// One-shot popup messages
// ---------------------------------------------------------------------------

async function handle(msg: RuntimeMessage): Promise<RuntimeStateResponse> {
  switch (msg.type) {
    case 'getState': {
      const [identity, room] = await Promise.all([loadOrCreateIdentity(), loadRoom()]);
      return { identity, room };
    }
    case 'setRoom': {
      if (msg.room !== null && !isValidRoomId(msg.room)) {
        // Reject silently and return current state.
        const [identity, room] = await Promise.all([loadOrCreateIdentity(), loadRoom()]);
        return { identity, room };
      }
      await setRoom(msg.room);
      const [identity, room] = await Promise.all([loadOrCreateIdentity(), loadRoom()]);
      broadcast({ type: 'state', identity, room });
      return { identity, room };
    }
    case 'generateRoom': {
      const newRoom = generateRoomId();
      await setRoom(newRoom);
      const identity = await loadOrCreateIdentity();
      broadcast({ type: 'state', identity, room: newRoom });
      return { identity, room: newRoom };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: RuntimeMessage, _sender, sendResponse) => {
  void handle(msg).then(sendResponse);
  // Tell Chrome we'll call sendResponse asynchronously.
  return true;
});

// Bootstrap identity on install so the popup never sees a missing one.
chrome.runtime.onInstalled.addListener(() => {
  void loadOrCreateIdentity();
});
