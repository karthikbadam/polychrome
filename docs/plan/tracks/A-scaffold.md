# Track A - Scaffold

**Wave**: 1 (must complete before any other track starts)
**Depends on**: nothing
**Blocks**: every other track

## Goal

Stand up the monorepo skeleton so all other tracks have empty,
correctly-wired homes for their code. Archive the 2014 codebase. Wire up
build, lint, test, and CI plumbing.

## Files I own (exclusive)

- `pnpm-workspace.yaml`
- `turbo.json`
- `package.json` (root)
- `tsconfig.base.json`
- `.gitignore` (replace existing)
- `.editorconfig`
- `.prettierrc`
- `.eslintrc.cjs`
- `vitest.config.ts` (root, shared config)
- `.github/workflows/ci.yml`
- `legacy/**` - move all 2014 files here
- Stub `package.json` + `src/index.ts` + `tsconfig.json` for every
  package and app folder defined in `01-architecture.md`
- Stub `apps/extension/manifest.json`
- Stub `apps/extension/vite.config.ts`

## Files I do NOT touch

- Anything under `apps/extension/src/<feature>/` beyond an `index.ts`
  stub re-exporting `{}` - those are owned by other tracks.
- Anything under `packages/<x>/src/` beyond `index.ts` re-export stub.

## Steps

1. **Archive legacy code.** Create `legacy/` directory. Move:
   - `polychrome-server.js` → `legacy/`
   - `peer/`, `display/`, `routes/`, `views/`, `public/`, `cache/` → `legacy/`
   - `bundle.js`, `polychrome.bat`, `pages.txt`, `testing.js` → `legacy/`
   - `screenshots/` → `legacy/screenshots/`
   - `TODO.txt` → `legacy/`
   - Old `package.json` → `legacy/package.json.original`
   - Old `README.md` → `legacy/README.md`
2. **Init pnpm workspace.** Write `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - "apps/*"
     - "packages/*"
     - "examples/*"
   ```
3. **Root package.json** with scripts: `dev`, `build`, `test`, `lint`,
   `typecheck`, `format`. Use Turborepo to orchestrate.
4. **TypeScript base config.** `tsconfig.base.json` with strict mode,
   `moduleResolution: "bundler"`, `target: "ES2022"`, paths for
   `@polychrome/*` aliases.
5. **Create directory tree** matching `01-architecture.md` repo layout
   exactly. Each package/app gets:
   - `package.json` (name, version, exports, deps)
   - `tsconfig.json` extending base
   - `src/index.ts` with `export {};` placeholder
   - `README.md` pointing to its track in `docs/plan/tracks/`
6. **Extension manifest stub.** `apps/extension/manifest.json` per
   `07-extension-runtime.md` (host_permissions intentionally narrow:
   only the curated allowlist + `https://polychrome.app/examples/*`).
7. **Vite + crxjs config.** `apps/extension/vite.config.ts` using
   `@crxjs/vite-plugin`. Must produce a loadable
   `apps/extension/dist/` directory with one chunk per entrypoint
   (background, content, page-bridge, sidepanel, devtools, popup,
   options).
8. **ESLint + Prettier.** Strict, with import-order rules and
   `no-restricted-imports` blocking cross-package relative paths.
9. **Vitest** root config with workspace projects.
10. **CI workflow.** `.github/workflows/ci.yml`: pnpm install, lint,
    typecheck, test, build. No deploy step in v1.
11. **README at repo root.** Replace with a short pointer:
    "PolyChrome 2.0 - see `docs/plan/README.md` for architecture and
    implementation roadmap. Legacy 2014 code archived at `legacy/`."
12. **CONTRIBUTING.md** - pnpm setup, dev loop, "load unpacked" steps.

## Acceptance

- [ ] `pnpm install` succeeds at repo root.
- [ ] `pnpm build` succeeds and produces a loadable
      `apps/extension/dist/` (load-unpacked in chrome://extensions
      shows the extension with no errors in the SW console).
- [ ] `pnpm test` runs (zero tests is fine; just no errors).
- [ ] `pnpm typecheck` passes.
- [ ] `pnpm lint` passes.
- [ ] `git status` shows the move under `legacy/` as a single
      well-organized commit.
- [ ] All other tracks can `cd packages/<x>/` or `cd apps/extension/` and
      see a stub project ready for their work.
- [ ] No file outside `legacy/` references the old codebase.

## Notes for the agent

- Pin pnpm version via `packageManager` field.
- Pin Node version via `.nvmrc` and `engines`.
- Pin `@crxjs/vite-plugin` to a known-good version.
- Do not install Chakra UI here - UI tracks will add it as a workspace
  dependency.
- Do not write any business logic. Stubs only.
