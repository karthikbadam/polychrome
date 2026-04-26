# Contributing to PolyChrome 2.0

## Prerequisites

- Node.js 22+ (use `.nvmrc`: `nvm use`)
- pnpm 10+ (`npm install -g pnpm`)

## Setup

```bash
git clone <repo>
cd PolyChrome
pnpm install
```

## Dev loop

```bash
# Build all packages in watch mode
pnpm dev

# Typecheck across all workspaces
pnpm typecheck

# Lint
pnpm lint

# Run all tests
pnpm test

# Production build
pnpm build
```

## Loading the extension unpacked in Chrome

1. Run `pnpm build` — output goes to `apps/extension/dist/`.
2. Open `chrome://extensions`.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select `apps/extension/dist/`.
5. The PolyChrome icon should appear in the toolbar.
6. Open the DevTools panel, side panel, or popup to verify no errors in the SW console.

## Repo layout

See [`docs/plan/01-architecture.md`](docs/plan/01-architecture.md) for the full repo layout and process boundaries.

## Track ownership

Each feature area is owned by a specific track in [`docs/plan/tracks/`](docs/plan/tracks/).
Do not edit files outside your track's ownership list.
