/**
 * @polychrome/ot-core — public API
 *
 * All consumers must import from '@polychrome/ot-core' only.
 * No deep imports are allowed.
 */

// Main engine
export { OtEngine } from './engine.js';
export type { OtEngineOptions } from './engine.js';

// Pure functions
export { transform, assertNever } from './transform.js';
export { invert } from './invert.js';

// State
export { State } from './state.js';
export type { StateSnapshot } from './state.js';

// Pending queue
export { PendingQueue } from './queue.js';
export type { PendingEntry } from './queue.js';

// Leader election
export { LeaderStateMachine } from './leader.js';
export type {
  LeaderState,
  LeaderCallbacks,
  ClaimMessage,
} from './leader.js';
