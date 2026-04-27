/**
 * content/index.ts - PolyChrome content script (isolated world).
 *
 * Connects to the background SW over a long-lived port, receives the
 * current identity + room, and writes them onto document.documentElement
 * dataset attributes. The MAIN-world bridge (registered as a separate
 * world:"MAIN" content script in the manifest) picks them up via a
 * MutationObserver and stands up / tears down the Yjs runtime.
 */

import type { RuntimePushMessage } from '../background/shared.js';

const DATA_IDENTITY = 'polychromeIdentity';
const DATA_ROOM = 'polychromeRoom';

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
  port.onMessage.addListener(applyState);
  port.onDisconnect.addListener(() => {
    // SW cycles aggressively in MV3; reconnect after a small delay.
    setTimeout(connect, 250);
  });
}

connect();
