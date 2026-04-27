# PolyChrome 2.0

A modern reimplementation of [PolyChrome (Badam & Elmqvist, ITS '14)](https://dl.acm.org/doi/10.1145/2669485.2669518)
as a Chrome MV3 extension with a fully peer-to-peer architecture and a pure
Operational Transformation engine that enables deterministic action replay,
undo, and branching.

**Live demos:** https://karthikbadam.github.io/polychrome/

## Repository layout

```
apps/
  extension/        Chrome MV3 extension (scaffolded)
  landing/          GitHub Pages landing page
packages/
  protocol/         canonical Operation schema + codec
  ot-core/          pure OT transform/invert + leader election
  storage/          IndexedDB op log + snapshots + .polychrome.zip
  sdk/              page-side window.polychrome surface
  kiosk/            Yjs+y-webrtc runtime that powers the hosted demos
  replay-player/    skeleton for the OT replay UI
examples/           drawing, scatterplot, choropleth (D3 v7)
docs/plan/          architecture + per-track briefs
legacy/             archived 2014 PolyChrome code
scripts/
  build-gh-pages.sh stages everything for the GH Pages workflow
.github/workflows/
  ci.yml            lint, typecheck, test, build, upload extension artifact
  pages.yml         build + deploy to https://karthikbadam.github.io/polychrome/
```

## Status

See [`docs/plan/README.md`](docs/plan/README.md) for the per-track
status table.

Built: `protocol`, `ot-core`, `storage`, `signaling` adapters,
`sdk`, `kiosk`, all three example demos, the landing page, and the
GH Pages workflow.

Not yet implemented: replay player, background service worker, content
script, page bridge, side-panel / devtools / popup-options UIs, site
adapters, end-to-end integration. Per-track briefs live under
`docs/plan/tracks/`.

## Quick start

```bash
pnpm install
pnpm test                                       # ~174 tests
pnpm build                                      # turbo builds every package
pnpm --filter @polychrome/example-drawing dev   # localhost:5173
```

To stage the GH Pages bundle locally:

```bash
PC_PUBLISH_BASE=/polychrome/ bash scripts/build-gh-pages.sh
npx serve gh-pages-out
```

## Trying the hosted demos

Each demo at `https://karthikbadam.github.io/polychrome/examples/<name>/`
auto-installs `@polychrome/kiosk`, which connects to a y-webrtc room
keyed by the `?room=<id>` URL parameter. Open the URL in two tabs (or
share the "Copy invite link" from the bottom-left banner) and the
demos sync in real time. No extension required.

The kiosk supports three modes (configurable via `?mode=` URL param):

- `auto` (default) - use the extension if installed, else fall back to kiosk
- `kiosk` - always use the y-webrtc kiosk transport
- `extension` - require the extension; show a "needs extension" badge if absent

## Legacy

Original 2014 PolyChrome (Node proxy + PeerJS signaling) archived at
[`legacy/`](legacy/).
