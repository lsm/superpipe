# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SuperPipe is a pipeline engine for composing (a)sync operations with dependency injection. Its
selling point is that the invariants (declared dataflow, one error channel, one continuation
channel, one cancellation gate) live in the executor rather than in call-site discipline.

Two implementations share one core contract:

- `src/` — the TypeScript reference implementation, published to npm as `superpipe`.
- `go/` — a Go port (`github.com/lsm/superpipe/go`), same core contract in idiomatic Go, with
  documented divergences.
  `docs/go-port-spec.md` is the contract between them; every clause is traced to TS source.

A behavior change in `src/` is not done until the README, the flow-control contract test, the Go
spec, and the Go port agree with it, unless §2 of the spec records it as a deliberate divergence.

## Commands

Building needs a Node version the locked tsdown accepts: `^22.18.0 || >=24.11.0` (Node 23 and
24.0–24.10 are excluded). Tests run on Node 22/24/26 in CI; the published package supports Node ≥ 18.

```bash
npm test                      # vitest run (test/**/*.test.mjs, imports src/ directly — no build needed)
npm run watch                 # vitest watch mode
npm run coverage              # v8 coverage over src/**/*.ts (text + lcov + html in coverage/)
npx vitest run test/superpipe.test.mjs        # one file
npx vitest run -t "reason handler"            # tests whose name matches a pattern

npm run typecheck             # tsc --noEmit
npm run lint                  # biome check src test
npm run lint:fix              # biome check --write
npm run format                # biome format --write
npm run check:no-comments     # fails if any tracked .ts file contains a comment (CI)
node scripts/strip-comments.mjs   # strips comments from tracked .ts files in place

npm run build                 # tsdown → dist/ (index.js CJS, index.mjs ESM, .d.ts/.d.mts,
                              #   superpipe.js + superpipe.min.js IIFE with global `Superpipe`)
npm run lint:pkg              # publint + arethetypeswrong on the built package (run after build)
npm run bench                 # build, then bench/perf.mjs, async.mjs, mem.mjs (not run in CI)
```

Go port (from `go/`; CI runs on Go 1.22 and stable):

```bash
test -z "$(gofmt -l .)"   # gofmt -l alone exits 0 even when it lists unformatted files
go vet ./...
go test -race ./...
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, check:no-comments, and tests per Node
version; build + lint:pkg on Node 26; the Go steps above; and a coverage job that publishes a badge
to the `badges` branch on master pushes.

`Makefile` and `rollup.config.mjs` are leftovers from the pre-tsdown build; the rollup plugins
are not installed. Do not use or extend them.

## Code Style and Repo Conventions

- Biome: single quotes, no semicolons, trailing commas, 2-space indent, 100-column lines.
- **Zero comments in `.ts` sources** (line, block, and JSDoc), enforced by
  `npm run check:no-comments` over every tracked `*.ts` file. The only exemptions are functional
  directives: shebangs, `/// <reference>`, `@ts-*`, `biome-ignore`, and `v8`/`istanbul`/`c8`
  coverage ignores. Tests (`.mjs`), `scripts/`, `bench/`, and Go files may have comments.
- Tests use vitest with chai-style assertions (`expect(x).to.equal(y)`). Callback-driven cases
  wrap in `new Promise((done) => …)` and call `done()` from inside the pipeline.
- `test/flow-control-contract.test.mjs` pins the behaviors the README promises. Change README
  and this file together.
- Commit messages use conventional prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`,
  `ci:`, `bench:`, `feat(go):`). Releases are a `chore(release): X.Y.Z` commit that bumps
  `package.json` and adds a hand-written `X.Y.Z YYYY-MM-DD` section (underlined with `=`) to
  the top of `CHANGELOG.md`.

## Architecture (TypeScript)

### Construction → run

```
superpipe(deps)                     src/index.ts — factory; deps are shared by every pipeline
  └─ sp(name, defs?)                declarative defs array → builds and returns .end() immediately
       └─ new Pipeline(name, deps)  src/pipeline/Pipeline.ts — fluent builder
            .input() .pipe() .error() .onExit() .reason()
            .end(output?)           → sync runner: runPipeline(), then Fetcher('raw').fetch(container)
            .endAsync(output?)      → promise runner with .withSignal(signal, ...args)
                 └─ runPipeline()   src/pipeline/executor.ts — one PipeState per run
```

`end()`/`endAsync()` snapshot the builder into an immutable `PipelineBase`; the returned runner is
reusable and every invocation gets a fresh container.

### The three collaborators in a pipe

Each `Pipe` (`src/pipeline/Pipe.ts`) is a function reference plus a `Fetcher` and a `Producer`,
built by `src/pipeline/builder.ts`:

- **Fetcher** (`src/parameter/Fetcher.ts`) turns the input spec into the argument list. Forms:
  no spec (the invocation args pass through), `['a','b']` positional, `'{a, b}'` one object
  argument. Lookup is own-property, container first then deps, `undefined` if absent. The
  reserved key `next` yields a once-only wrapper (`once()`) registered on the pipe's
  `NextCallbacks` so the executor can hold, flush, or disable it.
- **Producer** (`src/parameter/Producer.ts`) turns the return value into container entries.
  Output grammar: `'out'` binds the whole value; `'{a, b}'` picks; `['a','b']` destructures
  (positional for arrays, by name for objects); `'{...}'` merges every own key; `'src:dst'`
  renames; `'result:<name>'` opts into the `{ value }` / `{ reason }` protocol where `reason`
  binds and stops the run successfully. No spec means effects only, the return is discarded.
  Destructuring specs validate presence and throw `OutputKeyError` at the producing pipe;
  values delivered alongside an error (`next(err, partial)`) merge leniently. The same class in
  `'input'` mode maps `.input()` positional args.
- **Function resolution**: a string `fn` is resolved at run time (`!` inverts booleans, `?` skips
  the pipe when the function or any declared input is unresolved), container first then deps. A
  resolved raw boolean, or the boolean result of a `!`-prefixed pipe, is flow control (`false`
  halts). A plain function pipe's boolean return is data.

### Executor (`src/pipeline/executor.ts`)

- `runPipeline()` merges input pipes into the container, then calls `next()`.
- `next()` is a trampoline: while `state.driving`, continuations are queued rather than
  recursed, so 100k-deep pipelines never overflow the stack (bench/perf.mjs checks this).
- `continuePipeline()` merges the previous pipe's produced output via `mergeIntoContainer()`
  (which rejects the reserved name `next` and any output that would shadow a configured dep;
  invocation inputs may override deps), records the active error if one arrived, then either
  executes the next pipe, halts, settles, or dispatches the single error handler.
- `executePipe()` invokes the function with `next` callbacks *held* so a synchronous `next()`
  inside the body is replayed after the call returns. A thenable return is adopted as the
  continuation; a pipe that both declares `next` and returns a thenable throws
  `AmbiguousContinuationError`. `state.pending` counts outstanding `next` wrappers and promises
  and blocks advancement until they drain.
- Framework errors (`NextCalledTwiceError`, `OutputNameError`, `OutputKeyError`,
  `AmbiguousContinuationError`) surface to the caller (thrown from a sync runner, rejected from
  `endAsync`) and are never routed to the error handler.
- `settle()` defers a *successful* settlement by one microtask under `endAsync` so an error
  dispatched in the same unwind wins; failures settle synchronously. The promise rejects with the
  active error even when an error handler ran.
- Cancellation (`cancelRun()` via `withSignal`) disables every live `next` wrapper, marks the
  run aborted, and rejects with `PipelineAbortedError` without calling the error handler.
- Exit channel: `recordExit()` stores the first exit (`via`: value/reason/halt/error/abort, step,
  name, reason, error); `dispatchExit()` runs `.reason()` then `.onExit()` handlers with a
  container snapshot minus `next`, each wrapped in `containHandler()` so a throwing or rejecting
  handler cannot change the outcome. Only computed when a pipeline has observers (`state.observed`).

### Invariants to preserve

- The active error lives on `PipeState`, not in the container: a value named `error` is data.
- One continuation channel per pipe: return value *or* `next`, never both.
- Container writes go through `setEntry()` so `__proto__` becomes an own key.
- Errors and abort are per run; the runner object is never mutated by a run.

## Go Port (`go/`)

The Go port implements the same core contract as the TS engine (`docs/go-port-spec.md` §4) but
is not a behavior-for-behavior clone: the spec's §2 table lists every deliberate divergence, and
several are observable. No `next` callback (a `StepFunc` blocks and returns `(any, error)`, so
callback-delivered booleans and a valueless `next()` have no Go spelling); `context.Context`
instead of `AbortSignal`; typed spec constructors (`Out`, `Pick`, `Destructure`, `Merge`,
`Rename`, `Result`) instead of the string grammar; builder funcs `Not`/`Optional` instead of
`!`/`?` sigils; one blocking `Run` that returns a nil result on any error; error-handler failures
joined into the returned error; own-key map reads with no prototype or accessor semantics; all
construction errors joined and reported at `Build`; and `errors.Is`-checkable sentinels in
`go/errors.go`. The Go port has no `.onExit()`/`.reason()` exit channel. When the TS contract
changes, check §2 first: if Go deliberately diverges on that behavior, update its divergence row;
otherwise update the numbered contracts in §4 and the Go tests alongside it.
