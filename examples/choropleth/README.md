# Choropleth - PolyChrome Example

A shared US-states choropleth built with D3 v7, TopoJSON, and
`@polychrome/sdk`. The year slider and the list of pinned states are
shared across all peers.

## What it demonstrates

- `polychrome.share('year', n)` - synchronized year slider
- `polychrome.list('pinned')` - ordered list OT for pinning/unpinning states
- D3 v7 geo projections and path rendering
- TopoJSON feature/mesh extraction (`topojson-client`)
- Graceful degradation when the extension is not installed

## Shared keys used

| Key | Type | Description |
|-----|------|-------------|
| `year` | `number` | Currently selected year (1990–2020) |
| `pinned` (list) | `number[]` | FIPS state IDs of pinned states |

## Color encoding

Each state's color is a synthetic value: `(stateId × year) % 100`,
mapped to a sequential Blues color scale. This creates a visually
interesting pattern that changes as the year slider is moved.

## How to run locally

```bash
# From the repo root
pnpm --filter @polychrome/example-choropleth dev
# or from this directory
pnpm dev
```

Open http://localhost:5173 in your browser.

> Note: the map data is fetched from `cdn.jsdelivr.net` at runtime. An
> internet connection is required when first loading the page.

## Controls

- **Year slider** - change the year (1990–2020), synced to peers
- **Click a state** - pin it (appears in the sidebar); click again to unpin
- **Sidebar unpin button** - remove a state from the pinned list

## Testing cross-tab collaboration

1. Load the PolyChrome extension in Chrome.
2. Open two tabs pointing to the same PolyChrome session URL.
3. Move the year slider in one tab - the other tab updates instantly.
4. Pin a state in one tab - it appears in the sidebar of the other.

## Building

```bash
pnpm build
# output in dist/
```
