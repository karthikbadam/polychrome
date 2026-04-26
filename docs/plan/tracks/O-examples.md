# Track O — Example Apps (port from legacy)

**Wave**: 5 (after F)
**Depends on**: A, B, F
**Blocks**: nothing

## Goal

Port the three legacy PolyChrome example apps to standalone hosted
pages that use `@polychrome/sdk`. These prove the new system works
end-to-end and serve as the reference for future authors.

## Files I own (exclusive)

- `examples/drawing/` — port of `legacy/views/drawing.html`
  + `legacy/public/javascripts/drawing-script.js`
- `examples/scatterplot/` — port of `legacy/views/scatterplot.html`
- `examples/choropleth/` — port of `legacy/views/choropleth.html`
- Each example is a Vite app with `package.json`, `index.html`,
  `src/main.ts`, `src/style.css`, `vite.config.ts`, `README.md`.

## Stack per example

- TypeScript + Vite.
- D3 v7 (D3 v3 in legacy → upgrade).
- `@polychrome/sdk` from the workspace.
- No React. Plain TS + d3.
- Built output is a static directory hostable anywhere.

## Drawing example

**Behavior**: shared whiteboard. Multiple peers draw with their colors.

**Wiring**:
- A canvas element. Listen to `pointerdown/pointermove/pointerup`.
- For each completed stroke, call:
  `polychrome.list('strokes').insert(end, { color, points })`.
- On list change, redraw all strokes.
- Each peer's "in-flight" stroke is broadcast as `state_set`
  (`stroke.${actorId}.current`).
- Cursor positions handled by polychrome automatically (overlay).

## Scatterplot example

**Behavior**: shared interactive scatter plot. Peers can lasso-select
points; selection is shared. Zoom/pan also shared.

**Wiring**:
- Use a small CSV (Iris dataset shipped statically).
- D3 zoom: on zoom event, `polychrome.share('viewport.transform',
  d3.zoomTransform.toString())`.
- Lasso selection: on selection complete, `polychrome.share(
  'selection.indices', [number, ...])`.
- Subscribe: on remote update, apply transform / highlight points.
- A "checkpoint" button calls `polychrome.checkpoint('I see a
  cluster')`.

## Choropleth example

**Behavior**: shared US-states choropleth. Year slider is shared;
clicking a state pins it; pinned states list is shared.

**Wiring**:
- D3 geoPath + topojson (static topojson file).
- Year slider → `polychrome.share('year', n)`.
- Click state → `polychrome.list('pinned').insert(end, stateId)`
  (or remove if already pinned via `delete`).
- Subscribers update the rendering.

## README per example

Each example's README explains:
- What it demonstrates.
- How to run locally (`pnpm dev` from the example dir).
- How to load the extension and test cross-tab.
- The exact `polychrome.share`/`list` keys it uses (so the devtools
  panel shows recognizable names).

## Tests

- Unit-test pure data transforms (no DOM required).
- Visual smoke test in Playwright (Track Z): load example, simulate
  user input, assert state shares correctly via mocked SDK.

## Acceptance

- [ ] All three examples build with `pnpm --filter ./examples/* build`.
- [ ] Each example includes a working README.
- [ ] Each example uses ONLY the public `@polychrome/sdk` API (no
      private imports).
- [ ] Each example's output passes Lighthouse perf > 90 on a static
      build.
- [ ] At least one screenshot per example committed under
      `examples/<name>/screenshots/`.

## Notes for the agent

- Treat the legacy code as inspiration only; do not copy code
  directly. The data models are the same; the implementation is new.
- D3 v3 → v7 has breaking changes; rewrite scales / selections in
  modern style.
- Don't depend on the extension being installed for the page itself
  to function: the examples should work standalone (just no
  collaboration). Detect `window.polychrome` and gracefully degrade.
