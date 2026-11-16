---
name: verify
description: Prove a SuperPipe change works where a user meets it — the packed npm tarball installed into a fresh consumer project (ESM, CJS, browser IIFE, TypeScript types) and the Go module imported from a fresh Go module. Use before calling any change to src/, the build, package.json or go/ done.
---

# Verify SuperPipe as a user installs it

Unit tests import `src/` directly, so they cannot catch a broken build, a missing export, a bad
`exports` map, or shipped `.d.ts` files that do not compile. This skill checks the artifact a user
actually installs.

## Setup

- Node `^22.18.0 || >=24.11.0` (the locked tsdown refuses others), then `npm ci` at the repo root.
- Go 1.22 or newer on `PATH` for the Go check (or pass `--no-go`).
- No network beyond the `npm ci` above: the consumer installs the local tarball, which has no
  runtime dependencies, and the Go consumer uses a `replace` directive.

## Run

```bash
node scripts/verify-package.mjs            # build, pack, install, run every surface
node scripts/verify-package.mjs --no-go    # skip the Go consumer
node scripts/verify-package.mjs --keep     # keep the temp consumer to inspect it
```

Each check prints `PASS` or `FAIL` with its output; the last line is
`verify: N passed, M failed`, and the exit code is 0 only when nothing failed. A run that prints
no checks is a failure, not a pass.

What it does, in order:

1. `npm run build`, then `npm pack` into a temp directory.
2. Installs the tarball into a fresh consumer project (`npm install <tarball>`).
3. Runs the same smoke routine through `import 'superpipe'` (ESM), `require('superpipe')` (CJS),
   and `dist/superpipe.min.js` loaded as a script (global `Superpipe`). It covers the README quick
   start, sync output, a `!` gate, the declarative form, `endAsync`, `withSignal` abort, and the
   typed entry point at run time.
4. Type-checks a consumer file as `.mts` and as `.cts` against the shipped declarations with
   `--strict --skipLibCheck false` under `nodenext`. One line carries `@ts-expect-error`, so types
   that silently became `any` fail the check.
5. Builds and runs a throwaway Go module that imports `github.com/lsm/superpipe/go` through a
   `replace` directive, runs a gated pipeline, and checks cancellation reports `ErrAborted`.

## Proving a new feature

A change is verified when the new behavior is observed through the installed package, not only
in `test/`. When a change adds or alters a user-facing behavior:

- Add the README example's observable result to `smoke()` in `scripts/verify-package.mjs`
  (runs on all three JavaScript surfaces), and bump its summary count.
- If the change touches public types, add a line to `consumerTs` that only compiles when the
  types are right, plus an `@ts-expect-error` line for the misuse they must reject.
- If the Go port gains the behavior, extend the Go consumer's `main.go` and its expected output.

Then run the script and report its full output. To confirm a new check can fail, break the
behavior in `src/` temporarily, rerun, see the `FAIL`, and restore the file.

## Not covered

CI runs the unit, contract and type tests; this skill does not replace them and is not run in
CI. It does not exercise a real browser; the IIFE bundle runs in a Node `vm` context.
