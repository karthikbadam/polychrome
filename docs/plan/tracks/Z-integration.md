# Track Z — Integration & E2E

**Wave**: 6 (final)
**Depends on**: A through O (everything)
**Blocks**: nothing

## Goal

Wire all the pieces together, fill any cross-track gaps, and prove the
system works end-to-end. This is the only track that touches multiple
other tracks' code, and only for *integration glue* — never for
business logic.

## Files I own

- `apps/extension/src/background/wiring.ts` — assembles SessionsRegistry
  with concrete OtEngine + Storage + MeshManager + Adapters
- `apps/extension/src/content/wiring.ts` — assembles capture +
  dispatch + bridge + recorder
- `apps/extension/manifest.json` — final manifest (the scaffold's stub
  is replaced here once all entrypoints are real)
- `apps/extension/src/_health/index.ts` — debug "ping" route the SW
  exposes for e2e tests
- `e2e/` — root-level Playwright project
  - `e2e/playwright.config.ts`
  - `e2e/fixtures/extension.ts` — loads unpacked extension
  - `e2e/fixtures/two-profiles.ts` — spins up two Chrome profiles
  - `e2e/specs/01-handshake.spec.ts`
  - `e2e/specs/02-events.spec.ts`
  - `e2e/specs/03-replay.spec.ts`
  - `e2e/specs/04-undo-branch.spec.ts`
  - `e2e/specs/05-adapters.spec.ts`
- `docs/CHANGELOG.md` — start of changelog
- `docs/USER_GUIDE.md` — short end-user doc

## E2E specs

### 01-handshake
- Two profiles install extension.
- Profile A creates session → gets room code.
- Profile B joins via code.
- Both peer lists show both peers within 5s.

### 02-events
- Both join.
- A clicks an element on the example page.
- Within 200ms, B's tab dispatches a synthetic click event on the
  same element (verify via injected counter).

### 03-replay
- Capture 50 ops in a session.
- Side panel: scrub timeline to seq 25.
- Verify replay sandbox loads and replays.
- Resume live; verify subsequent ops dispatch.

### 04-undo-branch
- Set shared state via `polychrome.share('x', 1)` then `set('x', 2)`.
- Click undo → state is `1`.
- Branch from current seq → new room code.
- Continue editing → original session unchanged on other peer.

### 05-adapters
- For each adapter (observable, vega-editor, blocks, tableau-public):
  load a known sample page, simulate the adapter-specific
  interaction, verify a corresponding op was logged.

## Integration tasks beyond E2E

1. **Manifest finalization**: confirm all entrypoints (background,
   content, sidepanel, devtools, popup, options, page-bridge,
   adapters) are referenced and built by Vite + crxjs.
2. **Bundle audit**: run `pnpm build` and verify each bundle size is
   under its target (see acceptance for each track).
3. **Security review**: confirm no `eval`, no `Function(...)`, no
   inline scripts; CSP-friendly.
4. **Crash-free smoke**: load extension, install on a tab, leave for
   1 hour with no session — SW must sleep, no errors in console on
   wake.
5. **Memory leak smoke**: 1-hour session with continuous synthetic
   events — heap growth < 50MB.
6. **README at repo root** (final version): brief intro, install
   steps, link to `docs/USER_GUIDE.md`, link to `docs/plan/`.

## Acceptance

- [ ] All five E2E specs pass on CI.
- [ ] `pnpm build` produces a clean unpacked extension.
- [ ] `pnpm typecheck` clean across the workspace.
- [ ] `pnpm lint` clean.
- [ ] No track-A through track-O acceptance test is regressed.
- [ ] User guide answers: how to install, create session, join
      session, scrub timeline, undo, branch, export.
- [ ] Demo video script in `docs/USER_GUIDE.md` (don't record video
      here — that's a release task).

## Notes for the agent

- This track is sequential after all others by definition. Do not
  start until all preceding tracks have merged.
- If you discover gaps in another track's spec, file an issue
  (don't quietly patch). Update this document with the gap if it
  reveals a missing contract.
- Keep glue code minimal. If glue grows beyond ~200 LoC per file,
  it's a sign that a contract was wrong — push back upstream.
