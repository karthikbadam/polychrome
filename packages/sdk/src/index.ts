/**
 * @polychrome/sdk - public API
 *
 * All consumers must import from '@polychrome/sdk' only.
 * No deep imports are allowed.
 */

// Core API
export { createApi } from './api.js';
export type { ActorInfo, PeerInfo, PolyChromeApi } from './api.js';

// Shared<T>
export { share, subscribe } from './store.js';
export type { Shared } from './store.js';

// SharedList<T>
export { list } from './lists.js';
export type { SharedList } from './lists.js';

// Checkpoint
export { checkpoint } from './checkpoint.js';

// Declarative scanner
export { initDeclarative } from './declarative.js';

// Dispatch bus (for bridge / adapter authors)
export { listen, send } from './dispatch.js';
export type { Unsubscribe } from './dispatch.js';
