/**
 * checkpoint.ts - Named bookmark in the shared timeline.
 *
 * Sends a page/checkpoint bridge message so the content script can
 * forward it to the service worker as a checkpoint operation.
 */

import { makeLogger } from '@polychrome/protocol';

import { send } from './dispatch.js';

const log = makeLogger('sdk:checkpoint');

/**
 * Drop a named checkpoint into the collaborative timeline.
 */
export function checkpoint(label: string): void {
  log.debug('checkpoint', label);
  send({ type: 'page/checkpoint', label });
}
