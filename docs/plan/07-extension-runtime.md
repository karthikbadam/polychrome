# 07 — Extension Runtime & Message Routing

How the four worlds (service worker, content script, MAIN-world page
bridge, UI surfaces) communicate.

## The four worlds

| World | Lifetime | Has DOM? | Has `chrome.*`? | Owns... |
|-------|----------|----------|-----------------|---------|
| **Service worker** | Persistent (with alarms) | no | yes | OT engine, IndexedDB, mesh, signaling |
| **Content script (isolated)** | Per-tab | yes | partial (limited APIs) | event capture, re-dispatch, awareness overlay, rrweb |
| **MAIN-world page bridge** | Per-tab | yes | **no** | `window.polychrome` API, adapter loading |
| **UI documents** (side panel, devtools, popup, options) | Per-window | yes | yes | React + Chakra UI v3 |

## Channels

```
content (isolated)  ◄──── window.postMessage ────►  page-bridge (MAIN)
content (isolated)  ◄──── chrome.runtime.connect ──►  service worker
ui-document         ◄──── chrome.runtime.sendMessage / connect ──►  service worker
service worker      ◄──── chrome.tabs.sendMessage ──►  content (isolated)
```

The MAIN-world bridge **never** talks to the SW directly. It always
goes through the content script.

## Message types (SW ↔ content)

```ts
// packages/protocol/src/messages.ts
export type SwToContent =
  | { type: 'session/joined'; sessionId: SessionId; actorId: ActorId }
  | { type: 'session/left' }
  | { type: 'op/dispatch'; op: Operation }            // re-dispatch on this tab
  | { type: 'op/batch'; ops: Operation[] }
  | { type: 'cursor/peer'; actorId: ActorId; x: number; y: number; color: string }
  | { type: 'replay/start'; snapshot: SnapshotRecord }
  | { type: 'replay/end' }
  | { type: 'snapshot/please' }                       // request rrweb snapshot
  | { type: 'identity/update'; identity: IdentityRecord };

export type ContentToSw =
  | { type: 'op/local'; op: Omit<Operation,'seq'|'sessionId'|'actorId'|'clientSeq'|'parentSeq'|'ts'> }
  | { type: 'cursor/local'; x: number; y: number }
  | { type: 'snapshot/rrweb'; events: unknown[]; capturedAtSeq: Seq }
  | { type: 'page/ready'; url: string; title: string }
  | { type: 'page/adapter'; adapterId: string; capabilities: string[] };
```

## Message types (page bridge ↔ content)

The bridge uses `window.postMessage` with an envelope to disambiguate:

```ts
interface BridgeEnvelope { __polychrome: true; v: 1; body: BridgeMsg; }

type BridgeMsg =
  | { type: 'page/share';      key: string; value: unknown }
  | { type: 'page/list_op';    listId: string; op: 'insert'|'delete'; index: number; value?: unknown }
  | { type: 'page/checkpoint'; label: string }
  | { type: 'page/subscribe';  key: string }
  | { type: 'page/unsubscribe'; key: string }
  | { type: 'content/event';   eventName: string; data: unknown };  // SW->page push
```

Origin check: content script ignores messages where
`event.source !== window` or `event.data.__polychrome !== true`.

## Service worker keepalive

MV3 service workers stop after ~30s idle. We keep alive ONLY when a
session is active:

```ts
// background/keepalive.ts
chrome.alarms.create('pc-keepalive', { periodInMinutes: 0.4 });  // 24s
chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === 'pc-keepalive' && hasActiveSession()) {
    // touch self to reset idle timer
    self.registration.update();
  }
});
```

When no session is active we let the SW sleep; on next op or UI ping,
it wakes naturally.

## Permissions (manifest.json)

```json
{
  "manifest_version": 3,
  "name": "PolyChrome 2.0",
  "version": "0.1.0",
  "permissions": [
    "storage",
    "alarms",
    "scripting",
    "tabs",
    "sidePanel"
  ],
  "host_permissions": [
    "https://observablehq.com/*",
    "https://*.observableusercontent.com/*",
    "https://vega.github.io/editor/*",
    "https://bl.ocks.org/*",
    "https://public.tableau.com/*",
    "https://polychrome.app/examples/*"
  ],
  "background": { "service_worker": "src/background/index.ts", "type": "module" },
  "side_panel": { "default_path": "src/ui/sidepanel/index.html" },
  "devtools_page": "src/ui/devtools/devtools.html",
  "action": { "default_popup": "src/ui/popup/index.html" },
  "options_ui": { "page": "src/ui/options/index.html", "open_in_tab": true },
  "content_scripts": [
    {
      "matches": ["<see host_permissions>"],
      "js": ["src/content/index.ts"],
      "run_at": "document_start",
      "all_frames": true
    }
  ],
  "web_accessible_resources": [
    { "resources": ["src/main-world/page-bridge.js", "adapters/*.js"], "matches": ["<all_urls>"] }
  ]
}
```

The MAIN-world bridge is injected at runtime via
`chrome.scripting.executeScript({ world: 'MAIN', files: [...] })` from
the content script's startup.

## Adapter loading

When a page matches an allowlist URL pattern, the content script asks
the SW for the corresponding adapter module. SW returns the adapter
JS as a string (loaded once, cached); content script `executeScript`s
it into MAIN world. The adapter sees `window.polychrome` and registers
its hooks.

## Acceptance for runtime infra (cross-track)

- [ ] Round-trip latency for an op (content → SW → mesh → SW → content
      on a peer) is under 50ms on localhost.
- [ ] SW survives the keepalive interval as long as a session is
      active; sleeps within 60s of session end.
- [ ] No `chrome.runtime.lastError` warnings in the SW console under
      normal operation.
- [ ] The MAIN-world bridge does not pollute the page beyond
      `window.polychrome` (single key).
