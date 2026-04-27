# Scatterplot - PolyChrome Example

A shared interactive scatter plot of the Iris dataset built with D3 v7.
Peers see each other's axis selections and brush selection in real time.

## What it demonstrates

- `polychrome.share('axes.x', f)` / `polychrome.share('axes.y', f)` - synchronized axis dropdowns
- `polychrome.share('selection.box', [x0,y0,x1,y1])` - synchronized brush extent in **data coordinates** (so the same selection means the same set of points on every peer regardless of viewport size)
- `polychrome.checkpoint('I see a cluster')` - dropping a named checkpoint
- D3 v7 brush + axis + dot rendering
- Graceful degradation when neither the extension nor the kiosk is reachable

## Shared keys used

| Key | Type | Description |
|-----|------|-------------|
| `axes.x` | `'sepal_length' \| 'sepal_width' \| 'petal_length' \| 'petal_width'` | Currently plotted X feature |
| `axes.y` | same | Currently plotted Y feature |
| `selection.box` | `[number, number, number, number] \| null` | Brush extent `[x0, y0, x1, y1]` in data coords |

## How to run locally

```bash
# From the repo root
pnpm --filter @polychrome/example-scatterplot dev
# or from this directory
pnpm dev
```

Open http://localhost:5173 in your browser.

## Controls

- **X / Y axis dropdowns** - switch which Iris feature is plotted (synced to peers)
- **Drag** - draw a brush rectangle to select points (synced to peers)
- **Clear selection** - drops the brush (synced to peers)
- **Checkpoint** - records `"I see a cluster"` in the shared timeline

## Testing cross-tab collaboration

By default the example uses the kiosk transport (no extension required).

1. Open the deployed example in tab A. The bottom-left banner shows a room id.
2. Click "Copy invite link" and paste in tab B.
3. Brush in tab A; the same rectangle and the same highlighted dots appear in tab B.
4. Switch X/Y axis in either tab; the other tab follows.

## Building

```bash
pnpm build
# output in dist/
```
