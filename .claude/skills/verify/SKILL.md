---
name: verify
description: Prove a SuperPipe change works where a user meets it. Shared setup and gates (build, type check, lint, zero-comments, contract suites, package lint) live here; the journeys/ directory holds one file per user surface (installed npm package, Go module, a behavior change end to end). Use before calling any change to src/, the build, package.json or go/ done.
---

# Verify SuperPipe

Unit tests import `src/` directly, so they cannot catch a broken build, a missing export, a bad
`exports` map, or shipped `.d.ts` files that do not compile. The gates below are necessary; the
proof is a journey that observes the change through what a user installs.

## Setup

- Node `^22.18.0 || >=24.11.0` (the locked tsdown refuses others), then `npm ci` at the repo root.
- Go 1.22 or newer on `PATH` for anything under `go/`.
- Run from the repo root on macOS or Linux (the script spawns `npm` directly, which Windows
  does not support). Nothing here needs network after `npm ci`.

## Gates

Run in this order and stop at the first non-zero exit. CI runs the same steps
(`.github/workflows/ci.yml`); a gate that only CI ran is reported as CI's result, with the job
name.

```bash
npm run typecheck            # src, then the type tests in test/typed.test-d.ts
npm run lint                 # biome check src test
npm run check:no-comments    # no comments in any tracked .ts file
npm test                     # vitest, including the contract suites below
npm run build                # dist/: CJS, ESM, .d.ts/.d.mts, IIFE bundles
npm run lint:pkg             # publint + arethetypeswrong on the built package
```

For `go/`, from that directory:

```bash
files=$(gofmt -l .); echo "gofmt: ${files:-clean}"; test -z "$files"
go vet ./...
go test -race ./...
```

The contract suites pin README behavior; a README change and its suite change together:

| Behavior | Suite |
| --- | --- |
| flow control, output binding, cancellation, live deps | `test/flow-control-contract.test.mjs` |
| `.onExit()` / `.reason()` | `test/exit-channel.test.mjs` |
| `result:<name>` | `test/result-protocol.test.mjs` |
| typed builder inference | `test/typed.test-d.ts` (compiled by `npm run typecheck`, never executed) |

Run one suite with `npx vitest run test/<file>`.

## Journeys

List `.claude/skills/verify/journeys/` and read the files that match the change. Each journey
names its command, what a pass looks like, and how to prove its check can fail. Add a journey for
a new surface as a new file there.

## Reporting

Paste each command with its exit code and the last lines of output. A run that prints no checks,
or a gate skipped without saying so, is not a pass. Label anything you did not run.
