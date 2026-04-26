/**
 * dispatch.ts - postMessage bridge bus
 *
 * The SDK runs in MAIN world; it talks to the content script via
 * window.postMessage using BridgeEnvelope from @polychrome/protocol.
 *
 * send()   - wraps a BridgeMsg in a BridgeEnvelope and posts to window.
 * listen() - filters incoming postMessage events for BridgeEnvelopes
 *            and invokes the callback.
 */

import type { BridgeEnvelope, BridgeMsg } from '@polychrome/protocol';
import { makeLogger } from '@polychrome/protocol';

const log = makeLogger('sdk:dispatch');

export type Unsubscribe = () => void;

/**
 * Post a BridgeMsg to the window (picked up by content script).
 */
export function send(msg: BridgeMsg): void {
  const envelope: BridgeEnvelope = { __polychrome: true, v: 1, body: msg };
  log.debug('send', msg.type);
  window.postMessage(envelope, '*');
}

/**
 * Listen for incoming BridgeEnvelope messages from the content script.
 * Returns an unsubscribe function.
 */
export function listen(cb: (msg: BridgeMsg) => void): Unsubscribe {
  const handler = (event: MessageEvent): void => {
    // Only accept messages from our own window
    if (event.source !== window) return;

    const data = event.data as unknown;
    if (
      data === null ||
      typeof data !== 'object' ||
      !('__polychrome' in data) ||
      (data as BridgeEnvelope).__polychrome !== true
    ) {
      return;
    }

    const envelope = data as BridgeEnvelope;
    if (envelope.v !== 1) {
      log.warn('Received envelope with unknown version', envelope.v);
      return;
    }

    log.debug('recv', envelope.body.type);
    cb(envelope.body);
  };

  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}
