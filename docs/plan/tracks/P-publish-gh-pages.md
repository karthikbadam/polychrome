# Track P - Demo Site & GitHub Pages Publish

**Wave**: 5 (after F, O)
**Depends on**: A, F, O
**Blocks**: nothing

## Goal

Publish the example apps and a small landing page to **GitHub Pages**
so the project has a public demo URL. Provide a download link to the
unpacked extension `.zip` for users who want to install it.

The published site lives at:
`https://karthikbadam.github.io/PolyChrome/`

## Scope

The published artifact contains:

```
gh-pages/
├── index.html              landing page (what is PolyChrome 2.0, how to install)
├── examples/
│   ├── drawing/            built static example
│   ├── scatterplot/        built static example
│   └── choropleth/         built static example
├── docs/                   plan docs rendered as HTML (optional)
└── extension.zip           packaged unpacked extension for download
```

Users can:
- Visit `examples/drawing` in two browser tabs to see the standalone
  page (works without the extension).
- Download the `.zip`, extract, and load-unpacked in chrome://extensions
  to enable real-time collaboration.
- Read the docs/plan.

## Files I own (exclusive)

- `apps/landing/` - new app
  - `apps/landing/package.json`
  - `apps/landing/vite.config.ts`
  - `apps/landing/index.html`
  - `apps/landing/src/main.ts`
  - `apps/landing/src/style.css`
  - `apps/landing/public/` - favicons, screenshots
- `.github/workflows/pages.yml` - build + deploy workflow
- `scripts/build-gh-pages.sh` - orchestrates the multi-app build into
  one publish directory
- `docs/PUBLISH.md` - runbook for manual publish if needed

## What I do NOT touch

- `examples/*` - those are owned by Track O. I consume their `dist/`
  output.
- `apps/extension/` - owned by other tracks. I consume its `dist/`
  to package the .zip.

## Build pipeline (scripts/build-gh-pages.sh)

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Build everything
pnpm build

# 2. Stage the gh-pages output dir
OUT=gh-pages-out
rm -rf "$OUT"
mkdir -p "$OUT/examples" "$OUT/docs"

# 3. Copy each example
for ex in drawing scatterplot choropleth; do
  cp -r "examples/$ex/dist" "$OUT/examples/$ex"
done

# 4. Copy the landing page
cp -r apps/landing/dist/* "$OUT/"

# 5. Package the unpacked extension
( cd apps/extension && zip -r "../../$OUT/extension.zip" dist/ )

# 6. (Optional) render docs/plan/*.md to HTML - use a small script if needed

echo "Site staged at $OUT/"
```

## GitHub Actions workflow (.github/workflows/pages.yml)

Triggers on push to `main` (and the current claude/* branch via
manual dispatch). Builds, stages, deploys to `gh-pages` branch via
`actions/deploy-pages`.

Standard Vite-on-GitHub-Pages setup. Concurrency group prevents
double deploys.

## Vite base path

Each app that gets published needs `vite.config.ts` to set
`base: '/PolyChrome/<app-path>/'` so static asset URLs resolve.
For example:
- Landing: `base: '/PolyChrome/'`
- Drawing example: `base: '/PolyChrome/examples/drawing/'`
- Etc.

Use an env var `PC_PUBLISH_BASE` so local dev still uses `/`.

## Landing page content

Single-page, no framework needed. Plain HTML + CSS. Include:

1. **Hero** - "PolyChrome 2.0 - collaborative web visualization, in
   your browser." Tagline + screenshot.
2. **What is it** - three paragraphs from `docs/plan/README.md`
   tldr.
3. **Try the demos** - three big cards linking to the examples.
4. **Install the extension** - three numbered steps (download zip,
   extract, load unpacked). Big download button.
5. **For developers** - link to the GitHub repo and `docs/plan/`.
6. **Credit** - link to the original 2014 paper.

Use Chakra UI v3? **No** - landing should be zero-dep static HTML/CSS.
The plan's "Chakra v3 for all React UI" rule applies to extension
surfaces, not marketing pages.

## Acceptance

- [ ] `pnpm build && bash scripts/build-gh-pages.sh` produces a
      `gh-pages-out/` dir that can be served with `npx serve` and
      every link works.
- [ ] Each example loads from
      `http://localhost:3000/PolyChrome/examples/<name>/` with
      working interactivity (no broken asset paths).
- [ ] Extension `.zip` is < 5MB and loads cleanly via load-unpacked.
- [ ] GH Actions workflow runs green on push.
- [ ] Site is live at `https://karthikbadam.github.io/PolyChrome/`.

## Notes for the agent

- Confirm with the user that the GH Pages source is set to
  "GitHub Actions" in the repo settings before pushing the workflow.
- The landing page should clearly state "v0.1 - under active
  development" since most extension features aren't wired yet.
- For the docs/ section, you can either: (a) skip it for v1; (b) use
  a minimal markdown-to-html script (e.g. `marked`); (c) point to
  GitHub's rendered markdown. Recommended: (c) to avoid scope
  creep.
