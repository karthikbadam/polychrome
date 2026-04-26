/**
 * signaling/index.ts — public API for the signaling module
 *
 * All external consumers import from here only.
 */

export type {
  AdapterSignalingMessage,
  SignalingAdapter,
  Unsubscribe,
} from './adapter.js';

export { MeshManager, DEFAULT_ICE_SERVERS } from './mesh.js';
export type { MeshManagerOptions } from './mesh.js';

export { PeerConnection } from './peer-connection.js';
export type { PeerConnectionOptions, RTCFactory } from './peer-connection.js';

export { createCursorThrottle } from './throttle.js';
export type { SendFn } from './throttle.js';

// Adapters
export { PeerJsPublicAdapter } from './adapters/peerjs-public.js';
export { P2pcfWorkerAdapter } from './adapters/p2pcf-worker.js';
export { MdnsFallbackAdapter, MDNS_NOT_IMPLEMENTED_REASON } from './adapters/mdns-fallback.js';
