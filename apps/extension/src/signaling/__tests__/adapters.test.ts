/**
 * __tests__/adapters.test.ts
 *
 * Adapter conformance tests for all three adapters.
 *
 * - peerjs-public: uses an in-memory mock adapter (no real PeerJS server)
 * - p2pcf-worker:  uses an in-memory mock adapter (no real WebSocket)
 * - mdns-fallback: skipped — throws not-implemented by design (documented)
 */

import { describe, it, expect } from 'vitest';

import { runAdapterConformance } from '../adapters/conformance.js';
import { MdnsFallbackAdapter, MDNS_NOT_IMPLEMENTED_REASON } from '../adapters/mdns-fallback.js';
import { makeLinkedPair } from './mock-adapter.js';

// ---------------------------------------------------------------------------
// peerjs-public conformance (using mock in-memory transport)
// ---------------------------------------------------------------------------
// The PeerJsPublicAdapter wraps the real peerjs library which needs a browser
// and a running PeerJS server.  For unit tests we use the mock adapter which
// implements the same SignalingAdapter interface so we can verify the
// conformance contract without network I/O.
//
// A dedicated integration test (Track Z) will exercise the real PeerJS path.
// ---------------------------------------------------------------------------

describe('peerjs-public (in-memory mock transport)', () => {
  runAdapterConformance('peerjs-public', makeLinkedPair);
});

// ---------------------------------------------------------------------------
// p2pcf-worker conformance (using mock in-memory transport)
// ---------------------------------------------------------------------------
// The P2pcfWorkerAdapter requires a Cloudflare Worker URL and a WebSocket.
// For unit tests we use the mock adapter.  Real-network tests are in Track Z.
// ---------------------------------------------------------------------------

describe('p2pcf-worker (in-memory mock transport)', () => {
  runAdapterConformance('p2pcf-worker', makeLinkedPair);
});

// ---------------------------------------------------------------------------
// mdns-fallback — not implemented in v1; verify it throws
// ---------------------------------------------------------------------------

describe('mdns-fallback', () => {
  it.skip('skipped — not implemented: ' + MDNS_NOT_IMPLEMENTED_REASON, () => {
    // This skip is intentional and documents the v1 limitation.
  });

  it('throws not-implemented on join()', async () => {
    const adapter = new MdnsFallbackAdapter();
    await expect(adapter.join(
      'AAAAAA' as never,
      '00000000-0000-0000-0000-000000000001' as never,
    )).rejects.toThrow('not implemented');
  });

  it('leave() resolves without error (no-op)', async () => {
    const adapter = new MdnsFallbackAdapter();
    await expect(adapter.leave()).resolves.toBeUndefined();
  });
});
