#!/usr/bin/env bash
# Build all publishable artifacts and stage them in gh-pages-out/
# for deployment to GitHub Pages.
#
# Usage: PC_PUBLISH_BASE=/polychrome/ bash scripts/build-gh-pages.sh
#
# Idempotent. Safe to re-run.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BASE="${PC_PUBLISH_BASE:-/}"
OUT="${ROOT}/gh-pages-out"

echo "==> base path: ${BASE}"
echo "==> staging dir: ${OUT}"

# 1. Clean previous output
rm -rf "$OUT"
mkdir -p "$OUT/examples" "$OUT/docs"

# 2. Build everything (turbo will skip cached steps).
# Continue past per-package failures - partial publishes are useful in dev.
echo "==> building all packages and apps (best-effort)"
pnpm build || echo "    (some packages failed to build; continuing)"

# 3. Build landing page with publish base
echo "==> building landing page"
( cd apps/landing && PC_PUBLISH_BASE="${BASE}" pnpm build )
cp -r apps/landing/dist/. "$OUT/"

# 4. Build each example with its own base path
for ex in drawing scatterplot choropleth planets; do
  if [[ -d "examples/$ex" ]]; then
    echo "==> building example: $ex (relative-path build)"
    # Wipe the per-example dist first so a stale cached build cannot leak
    # through if vite build fails silently.
    rm -rf "examples/$ex/dist"
    ( cd "examples/$ex" && pnpm build )
    if [[ -d "examples/$ex/dist" ]]; then
      # Sanity: built HTML must use relative asset paths so the page works
      # under any URL prefix.
      if ! grep -qE 'src="\./assets/' "examples/$ex/dist/index.html"; then
        echo "    !! built index.html does not use relative asset paths"
        grep -oE 'src="[^"]*"' "examples/$ex/dist/index.html" || true
        exit 1
      fi
      mkdir -p "$OUT/examples/$ex"
      cp -r "examples/$ex/dist/." "$OUT/examples/$ex/"
    else
      echo "    (no dist for $ex; example may be a stub)"
      mkdir -p "$OUT/examples/$ex"
      cat > "$OUT/examples/$ex/index.html" <<HTML
<!doctype html><meta charset=utf-8><title>$ex (coming soon)</title>
<body style="font-family:system-ui;padding:64px;text-align:center">
<h1>$ex</h1><p>This example is still being implemented.</p>
<p><a href="../../">Back to PolyChrome</a></p></body>
HTML
    fi
  fi
done

# 5. Package the unpacked extension as a zip download
if [[ -d "apps/extension/dist" ]]; then
  echo "==> packaging extension.zip"
  ( cd apps/extension && rm -f "$OUT/extension.zip" && \
    zip -qr "$OUT/extension.zip" dist/ )
  echo "    extension.zip: $(du -h "$OUT/extension.zip" | cut -f1)"
fi

# 6. Drop a no-jekyll marker so GH Pages doesn't process underscores
touch "$OUT/.nojekyll"

# 7. Summary
echo ""
echo "==> staged at: $OUT"
echo "==> contents:"
find "$OUT" -maxdepth 2 -type f -o -type d | sort | sed "s|^${OUT}|.|"
