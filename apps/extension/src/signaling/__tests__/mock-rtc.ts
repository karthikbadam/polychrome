/**
 * __tests__/mock-rtc.ts
 *
 * Minimal in-process mock of RTCPeerConnection + RTCDataChannel for unit tests.
 * Node.js has no WebRTC implementation; real WebRTC is deferred to Track Z E2E.
 *
 * The mock wires two MockPeerConnection instances together directly:
 *   const [pcA, pcB] = MockPeerConnection.createPair();
 *
 * Then inject them as factories:
 *   new MeshManager({ __rtcFactory: makePairFactory(pcA, pcB), ... })
 *
 * Data sent on a channel is immediately delivered to the remote channel
 * (synchronously, through a microtask) to keep tests deterministic.
 */

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// MockDataChannel
// ---------------------------------------------------------------------------

type DCState = 'connecting' | 'open' | 'closing' | 'closed';

export class MockDataChannel {
  label: string;
  readyState: DCState = 'connecting';
  bufferedAmount = 0;

  /** Set by the test harness to link to the remote channel. */
  remote: MockDataChannel | null = null;

  onopen:    (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror:   ((ev: unknown) => void) | null = null;
  onclose:   (() => void) | null = null;

  constructor(label: string) {
    this.label = label;
  }

  /** Simulate the channel opening (called by harness). */
  simulateOpen(): void {
    this.readyState = 'open';
    this.onopen?.();
  }

  send(data: string): void {
    if (this.readyState !== 'open') return;
    if (this.remote?.readyState === 'open') {
      const remote = this.remote;
      Promise.resolve().then(() => {
        remote.onmessage?.({ data });
      });
    }
  }

  close(): void {
    this.readyState = 'closed';
    this.onclose?.();
  }
}

// ---------------------------------------------------------------------------
// MockPeerConnection
// ---------------------------------------------------------------------------

type ICEState = 'new' | 'checking' | 'connected' | 'completed' | 'failed' | 'disconnected' | 'closed';

export class MockPeerConnection {
  iceConnectionState: ICEState = 'new';

  onicecandidate: ((ev: { candidate: RTCIceCandidate | null }) => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  ondatachannel: ((ev: { channel: MockDataChannel }) => void) | null = null;

  private localDesc:  RTCSessionDescriptionInit | null = null;
  private remoteDesc: RTCSessionDescriptionInit | null = null;
  private channels: MockDataChannel[] = [];

  /** Remote side - linked by createPair(). */
  remote: MockPeerConnection | null = null;

  closed = false;

  /** Tracks are keyed by channel label. */
  private remoteChannels = new Map<string, MockDataChannel>();

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'offer', sdp: 'mock-offer' };
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    return { type: 'answer', sdp: 'mock-answer' };
  }

  async setLocalDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.localDesc = desc;
  }

  async setRemoteDescription(desc: RTCSessionDescriptionInit): Promise<void> {
    this.remoteDesc = desc;
  }

  get localDescription(): RTCSessionDescriptionInit | null {
    return this.localDesc;
  }

  async addIceCandidate(_candidate: RTCIceCandidate): Promise<void> {
    // No-op in mock
  }

  createDataChannel(label: string, _options?: RTCDataChannelInit): MockDataChannel {
    const ch = new MockDataChannel(label);
    this.channels.push(ch);
    return ch;
  }

  close(): void {
    this.closed = true;
    this.iceConnectionState = 'closed';
    for (const ch of this.channels) {
      if (ch.readyState !== 'closed') ch.close();
    }
    for (const ch of this.remoteChannels.values()) {
      if (ch.readyState !== 'closed') ch.close();
    }
  }

  /**
   * Link two MockPeerConnections so channels created on A are delivered to B.
   * Call after setRemoteDescription on both sides.
   */
  linkChannels(): void {
    // pair each local channel with a matching remote channel
    for (const localCh of this.channels) {
      const remoteCh = new MockDataChannel(localCh.label);
      localCh.remote = remoteCh;
      remoteCh.remote = localCh;
      this.remoteChannels.set(localCh.label, remoteCh);

      // Deliver ondatachannel to the remote PC
      if (this.remote) {
        const remotePc = this.remote;
        remotePc.ondatachannel?.({ channel: remoteCh });
      }

      // Open both sides
      Promise.resolve().then(() => {
        localCh.simulateOpen();
        remoteCh.simulateOpen();
      });
    }
  }

  /** Simulate ICE connected state. */
  simulateConnected(): void {
    this.iceConnectionState = 'connected';
    this.oniceconnectionstatechange?.();
  }

  /** Create a linked pair of mock PeerConnections. */
  static createPair(): [MockPeerConnection, MockPeerConnection] {
    const a = new MockPeerConnection();
    const b = new MockPeerConnection();
    a.remote = b;
    b.remote = a;
    return [a, b];
  }
}

// ---------------------------------------------------------------------------
// RTCFactory helpers
// ---------------------------------------------------------------------------

/**
 * Create an RTCFactory that returns mock PeerConnections from a pre-made pool.
 * Each call pops the next connection from the pool.
 *
 * Usage:
 *   const [pcA, pcB] = MockPeerConnection.createPair();
 *   const factoryA = makeRtcFactory([pcA]);
 *   const factoryB = makeRtcFactory([pcB]);
 */
export function makeRtcFactory(
  pool: MockPeerConnection[],
): (config: RTCConfiguration) => RTCPeerConnection {
  let idx = 0;
  return (_config: RTCConfiguration) => {
    const pc = pool[idx++];
    if (!pc) throw new Error('makeRtcFactory: pool exhausted');
    return pc as unknown as RTCPeerConnection;
  };
}

/**
 * Convenience: create a pair factory that intercepts the offer/answer exchange
 * and wires data channels automatically once setRemoteDescription is called.
 *
 * Returns { factoryA, factoryB, pcA, pcB }.
 *
 * After calling start() on both PeerConnections pass the signaling messages
 * back and forth; this helper wires the internal RTCPeerConnection mocks so
 * that data channels open automatically.
 */
export function createMockRtcPair(): {
  factoryA: (cfg: RTCConfiguration) => RTCPeerConnection;
  factoryB: (cfg: RTCConfiguration) => RTCPeerConnection;
  pcA: MockPeerConnection;
  pcB: MockPeerConnection;
} {
  const [pcA, pcB] = MockPeerConnection.createPair();

  // Override setRemoteDescription to auto-link channels
  const origSetRemA = pcA.setRemoteDescription.bind(pcA);
  pcA.setRemoteDescription = async (desc) => {
    await origSetRemA(desc);
    if (desc.type === 'answer') {
      // A just got the answer - link channels
      pcA.linkChannels();
    }
  };

  const origSetRemB = pcB.setRemoteDescription.bind(pcB);
  pcB.setRemoteDescription = async (desc) => {
    await origSetRemB(desc);
    // B got the offer; channels created after this, then answer sent.
    // No auto-link yet; pcA.linkChannels() will be called when pcA gets answer.
  };

  return {
    factoryA: makeRtcFactory([pcA]),
    factoryB: makeRtcFactory([pcB]),
    pcA,
    pcB,
  };
}

// Export spy helpers to satisfy vitest expectations
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- @reason: spy type is internal to vitest
export const mockRtcPeerConnection: (...args: any[]) => any = vi.fn();
