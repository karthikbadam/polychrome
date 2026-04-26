# Drawing — PolyChrome Example

A shared whiteboard built with HTML5 Canvas and `@polychrome/sdk`.
Multiple peers can draw freehand strokes simultaneously; each stroke
is broadcast to all connected peers in real time.

## What it demonstrates

- `polychrome.list('strokes')` — ordered list OT for appending and clearing strokes
- Graceful degradation when the extension is not installed (local-only mode)
- Pointer event handling (works with mouse, pen, and touch)

## Shared keys used

| Key | Type | Description |
|-----|------|-------------|
| `strokes` (list) | `{ color: string; points: [{x,y}…] }[]` | All completed strokes |

## How to run locally

```bash
# From the repo root
pnpm --filter @polychrome/example-drawing dev
# or from this directory
pnpm dev
```

Open http://localhost:5173 in your browser.

## Testing cross-tab collaboration

1. Load the PolyChrome extension in Chrome (`chrome://extensions` → Load unpacked → `apps/extension/dist`).
2. Open two tabs pointing to the same PolyChrome session URL.
3. Draw in one tab — strokes appear instantly in the other.
4. Use the **Clear** button to erase the canvas on all peers.

## Building

```bash
pnpm build
# output in dist/
```
