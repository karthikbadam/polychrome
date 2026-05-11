# Track N - Site Adapters

**Wave**: 5 (after F, J)
**Depends on**: A, B, F, J
**Blocks**: nothing

## Goal

Per-site adapter modules that activate the extension on curated
sites. Each adapter is a small TypeScript module loaded into MAIN
world; it identifies interactive elements, listens for their changes,
and wires them to `window.polychrome` calls.

## Files I own (exclusive)

- `apps/extension/src/adapters/index.ts` - registry + `getAdapter(url)`
- `apps/extension/src/adapters/_base/Adapter.ts` - base interface
- `apps/extension/src/adapters/_base/utils.ts` - DOM helpers
- `apps/extension/src/adapters/observable/index.ts`
- `apps/extension/src/adapters/observable/__tests__/**`
- `apps/extension/src/adapters/vega-editor/index.ts`
- `apps/extension/src/adapters/vega-editor/__tests__/**`
- `apps/extension/src/adapters/blocks/index.ts`
- `apps/extension/src/adapters/blocks/__tests__/**`
- `apps/extension/src/adapters/tableau-public/index.ts`
- `apps/extension/src/adapters/tableau-public/__tests__/**`

## Adapter interface

```ts
// apps/extension/src/adapters/_base/Adapter.ts
export interface Adapter {
  id: string;                                          // e.g. 'observable'
  matches(url: string): boolean;
  init(api: PolyChromeApi): Adapter.Lifecycle;
  capabilities: AdapterCapability[];
}

export interface Lifecycle {
  /** Called when the page is ready and the adapter should hook in. */
  attach(): Promise<void>;

  /** Called on URL change within SPA, or session leave. */
  detach(): Promise<void>;

  /** True if the adapter wants to share this DOM event. */
  isShareable(target: Element, eventType: string): boolean;
}

export type AdapterCapability =
  | 'dom-events'        // standard click/move/etc on identified elements
  | 'shared-state'      // adapter exposes named app state (e.g. Vega signals)
  | 'snapshots';        // adapter handles its own snapshot fidelity
```

## v1 adapters

### `observable`
- Matches: `https://observablehq.com/*`
- Hooks: identifies notebook input cells (`.observablehq--input`),
  scrubbers, dropdowns. Wires their values to `polychrome.share(`cell.<name>`, value)`.
- Listens for cell re-evaluations and broadcasts as `state_set`.

### `vega-editor`
- Matches: `https://vega.github.io/editor/*`
- Hooks: subscribes to view signals via the Vega API (accessible
  through `window.VEGA_DEBUG` or the editor's exposed view object).
- Each signal change → `polychrome.share('signal.<name>', value)`.
- Reverse: when remote sets a signal, call `view.signal(name, value).run()`.

### `blocks` (bl.ocks.org archives)
- Matches: `https://bl.ocks.org/*`
- Many bl.ocks examples are static D3 demos. Default to "share all
  click/hover events with selectors" - relies on the generic capture
  path with no app-state knowledge.

### `tableau-public`
- Matches: `https://public.tableau.com/*`
- Hooks: uses the Tableau JS API
  (`tableau.extensions.dashboardContent`) if present in the page's
  context. Shares filter changes and parameter changes as `state_set`.

## Loading mechanism

1. Content script (Track I) reads URL, asks SW which adapter matches.
2. SW returns adapter id + adapter JS bundle URL (one bundle per
   adapter, output by Vite into `dist/adapters/`).
3. Content script `chrome.scripting.executeScript({ world: 'MAIN',
   files: [adapterBundle] })`.
4. Adapter, in MAIN world, waits for `window.polychrome:ready`, then
   calls `init(window.polychrome).attach()`.

Adapter modules are also web-accessible-resources (per
`07-extension-runtime.md`).

## Tests

For each adapter:
- Unit test `matches(url)` against positive + negative URLs.
- Mock the host site's relevant DOM, attach the adapter, simulate a
  user interaction, assert the right `polychrome.share` call was
  made.

## Acceptance

- [ ] All four adapters compile and bundle to < 30KB each.
- [ ] Each `matches()` correctly accepts/rejects URLs.
- [ ] Per-adapter integration test passes.
- [ ] No adapter throws if `window.polychrome` is undefined; instead
      it waits for the `polychrome:ready` event with a 5s timeout.
- [ ] Adapter registry returns `null` for non-allowlisted URLs (not a
      throw).

## Notes for the agent

- This track is *very* parallelizable internally - each adapter is
  independent. If you want, dispatch sub-subagents per adapter.
- Be respectful of the host sites' DOM: never modify nodes; only
  attach listeners and call public APIs.
- If a host site's API surface is unstable, document it in the
  adapter's `README.md` so future maintainers know what to recheck.
- Do NOT import from `apps/extension/src/content/` or `background/`.
  The adapter only knows about `@polychrome/sdk` and the host site.
