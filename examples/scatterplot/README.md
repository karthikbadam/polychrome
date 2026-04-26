# Scatterplot — PolyChrome Example

A shared interactive scatter plot of the Iris dataset built with D3 v7
and `@polychrome/sdk`. Peers can pan/zoom and lasso-select data points;
both the viewport transform and the selection are shared in real time.

## What it demonstrates

- `polychrome.share('viewport.transform', …)` — synchronized pan/zoom
- `polychrome.share('selection.indices', […])` — synchronized lasso selection
- `polychrome.checkpoint('I see a cluster')` — dropping a named checkpoint
- D3 v7 zoom, axis, and path rendering
- Graceful degradation when the extension is not installed

## Shared keys used

| Key | Type | Description |
|-----|------|-------------|
| `viewport.transform` | `string` | D3 zoom transform string, e.g. `translate(x,y) scale(k)` |
| `selection.indices` | `number[]` | Row indices of lasso-selected points |

## How to run locally

```bash
# From the repo root
pnpm --filter @polychrome/example-scatterplot dev
# or from this directory
pnpm dev
```

Open http://localhost:5173 in your browser.

## Controls

- **X / Y axis dropdowns** — switch which Iris feature is plotted
- **Scroll / drag** — pan and zoom (transform is synced to peers)
- **Shift+drag** — lasso-select points (selection synced to peers)
- **Checkpoint** button — records `"I see a cluster"` in the shared timeline
- **Reset view** — snaps zoom back to identity

## Testing cross-tab collaboration

1. Load the PolyChrome extension in Chrome.
2. Open two tabs pointing to the same PolyChrome session URL.
3. Lasso-select points in one tab — highlighted points appear in the other.
4. Pan/zoom in one tab — the other tab follows.

## Building

```bash
pnpm build
# output in dist/
```
