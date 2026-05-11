/**
 * content/index.ts - PolyChrome content script (isolated world).
 *
 * Two-way bridge between MAIN-world and the SW:
 *   - SW -> bridge: the SW pushes the current identity + room over a
 *     long-lived port; we write them onto documentElement.dataset so
 *     the MAIN-world bridge picks them up via a MutationObserver.
 *   - bridge -> SW: the MAIN-world bridge dispatches periodic
 *     `polychrome:tabState` window messages with url/room/peerCount;
 *     we forward them over the same port so the SW can render a
 *     cross-tab dashboard in the popup.
 */

import type { BridgeTabState, RuntimePushMessage, RuntimePortMessage } from '../background/shared.js';

const DATA_IDENTITY = 'polychromeIdentity';
const DATA_ROOM = 'polychromeRoom';
const TAB_STATE_MESSAGE = 'polychrome:tabState';

let currentPort: chrome.runtime.Port | null = null;

function applyState(msg: RuntimePushMessage): void {
  if (msg.type !== 'state') return;
  const root = document.documentElement;
  root.dataset[DATA_IDENTITY] = JSON.stringify(msg.identity);
  if (msg.room === null) {
    delete root.dataset[DATA_ROOM];
  } else {
    root.dataset[DATA_ROOM] = msg.room;
  }
}

function connect(): void {
  const port = chrome.runtime.connect({ name: 'polychrome' });
  currentPort = port;
  port.onMessage.addListener(applyState);
  port.onDisconnect.addListener(() => {
    if (currentPort === port) currentPort = null;
    // SW cycles aggressively in MV3; reconnect after a small delay.
    setTimeout(connect, 250);
  });
}

connect();

// Forward bridge tab-state pushes (MAIN world -> isolated world via
// window.postMessage) over the SW port. The bridge only emits these
// while it's actively connected to a room.
window.addEventListener('message', (e: MessageEvent) => {
  if (e.source !== window) return;
  const data = e.data as { source?: string; state?: unknown } | null;
  if (!data || data.source !== TAB_STATE_MESSAGE) return;
  if (!currentPort) return;
  try {
    currentPort.postMessage({
      type: 'tabState',
      state: data.state as BridgeTabState,
    } satisfies RuntimePortMessage);
  } catch { /* port closed - will reconnect */ }
});
