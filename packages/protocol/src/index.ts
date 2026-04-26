/**
 * @polychrome/protocol — public API
 *
 * All consumers must import from '@polychrome/protocol' only.
 * No deep imports are allowed.
 */

export * from './types.js';
export * from './messages.js';
export * as coords from './coords.js';
export * as target from './target.js';
export * as codec from './codec.js';
export * as envelope from './envelope.js';
export { log, makeLogger } from './logger.js';
export type { Logger, LogLevel } from './logger.js';
export { newSessionId, newActorId } from './ids.js';

export const PROTOCOL_VERSION = 1 as const;
