# signaling/

WebRTC mesh + pluggable signaling layer for PolyChrome 2.0.

## Module map

| File | Purpose |
|---|---|
| `adapter.ts` | `SignalingAdapter` interface + `AdapterSignalingMessage` type |
| `mesh.ts` | `MeshManager` - session lifecycle, peer tracking, broadcast |
| `peer-connection.ts` | Single-peer RTCPeerConnection + two data channels |
| `throttle.ts` | Cursor coalescer at ≤30Hz (setTimeout, not rAF) |
| `adapters/peerjs-public.ts` | Adapter using public peerjs.com broker |
| `adapters/p2pcf-worker.ts` | Adapter using bring-your-own Cloudflare Worker |
| `adapters/mdns-fallback.ts` | Spike placeholder - throws `not-implemented` in v1 |
| `adapters/conformance.ts` | Shared conformance test suite for all adapters |
| `index.ts` | Public re-exports |

## RTCPeerConnection in MV3 Service Workers

### The unresolved question

Chrome MV3 service workers are not true DOM-bearing contexts.
`RTCPeerConnection` is listed as available in service workers in the spec, and
as of Chrome 110+ it does work in practice, but behaviour under MV3 lifecycle
events (SW suspension/restart) is not guaranteed.

Specifically: when the service worker is suspended and then restarted by an
extension event (e.g. `chrome.alarms`), any live `RTCPeerConnection` objects
are destroyed.  The extension must recreate the mesh after a SW restart.

### v1 approach

This module is written as if it runs in any context that has
`RTCPeerConnection` (SW or DOM document).  MeshManager accepts a
`__rtcFactory` option so the host can inject any factory, including one that
delegates to an offscreen document.

### Recommendation for Track H

Track H (background SW) should:

1. **Try direct RTCPeerConnection first.**  Chrome >= 110 supports it in SWs.
   Wire `MeshManager` with no `__rtcFactory` (uses the global constructor).

2. **If that fails** (or for robustness): create an offscreen document via
   `chrome.offscreen.createDocument({ reasons: ['WEB_RTC'], ... })` and proxy
   all `RTCPeerConnection` calls through a `chrome.runtime.connect` port.
   Pass an `__rtcFactory` that posts messages to the offscreen document.

3. **On SW restart**, call `mesh.stop()` in the old instance and `mesh.start()`
   again in the new one.  The signaling adapter will rejoin and trigger fresh
   ICE renegotiation with all peers.

The offscreen document orchestration is **Track H's responsibility**.
This module only needs to receive a working `RTCPeerConnection` factory.

### References

- [Chrome offscreen documents](https://developer.chrome.com/docs/extensions/reference/offscreen/)
- [RTCPeerConnection in service workers (crbug)](https://crbug.com/1247486)
- Track H owns `apps/extension/src/background/`.
