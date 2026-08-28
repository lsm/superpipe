# SuperPipe Go Port — Semantic Specification

Status: draft for review — the three §9 design questions are resolved
Reference: SuperPipe **0.17.0** (`origin/master` @ `bd1f70d`). Every contract below is
traceable to the TypeScript source; where Go spells things differently, the divergence is
explicit in §2 and the semantics are unchanged.

## 1. Purpose and principles

SuperPipe is a pipeline engine whose value is that **invariants live in the executor, not
in call-site discipline**. The Go port exists for the same reason it exists in TypeScript:
code whose correctness is checkable from declared structure — inputs, outputs, one error
path, one cancellation gate — instead of from context a reviewer (human or AI) doesn't have.

Principles that govern every design decision below:

1. **Declared dataflow.** A step's inputs and outputs are declared at construction and
   validated before any run. Nothing about data flow is implicit in step-body code.
2. **One continuation channel: the return.** A step's `(value, error)` return is the only
   way a result or failure leaves a step. There is no `next` callback.
3. **The framework carries the invariants.** Error routing, cancellation gating, duplicate
   `next` detection, output binding — enforced centrally, once, not per call site.
4. **Construction-time failure preferred.** Anything knowable before the first run is an
   error at build time (`End()`), not at run time.
5. **Semantic identity, idiomatic spelling.** §4 contracts are identical to 0.17.0;
   §2 lists every place the Go surface differs in form.

## 2. Deliberate divergences (form, not semantics)

| SuperPipe (TS) | Go port | Why |
| --- | --- | --- |
| `AbortSignalLike`, `run.withSignal(sig, ...)` | `context.Context` passed to `Run` | ctx is Go's cancellation primitive; a pre-cancelled ctx is the already-aborted signal; `context.Cause(ctx)` is the reason. No separate API. |
| String mini-grammar for specs (`'{a, b}'`, `['a']`, `'src:dst'`, `'{...}'`) | Typed constructors: `Out`, `Rename`, `Pick`, `Destructure`, `Merge` (§3.2) | One spec form, one meaning — expressed as types instead of regexes. Construction errors are the same class. |
| Pipe sigils `!fn` / `?fn` in the injected-name string | Builder methods `Not(...)`, `Optional(...)` | No stringly sigils; identical flag semantics. |
| Fluent `sp(name).pipe().pipe().end()` chain | `superpipe.Build(name, deps, defs...)` — variadic definition list; each def chains locally (`.In`/`.Out`) | The variadic-defs pattern is Go's idiomatic multi-part construction (`fx.Provide`, gRPC options); everything validates once at `Build`. |
| `next` callback, retained continuations, `NextCallbacks` wrapper registry | **No `next`** — a step is `func(ctx, args []any) (any, error)` and blocks until it has its result | `next` existed to return control to JS's single-threaded event loop. TS advancement already pauses on a live `next` (`pending > 0` blocks the next step), so a blocked step reproduces the identical observable timeline — and the dual-channel misuse class becomes unrepresentable. |
| Returned `Promise` desugars to `next` (thenable adoption) | A step just blocks and returns; no adoption machinery | Thenable desugar existed to unify callback and promise styles; Go has one style. |
| Microtask-deferred success settlement + trampoline (#57) | Neither exists: completions are in-band and totally ordered, and the run loop is a plain `for` loop | Out-of-band completions were the JS condition; with in-band returns the ordering race and the recursion hazard are unrepresentable. |
| JS single-threaded run-to-completion | **Single-goroutine executor per run** (§5). `Next.Call` is a channel send; all settlement happens on the run's loop goroutine | The 0.16 cancellation design leans on single-threaded settlement. The loop goroutine preserves that reasoning; without it, settlement races. |
| `end()` / `endAsync()` — two entry points; a blocking `end()` is impossible in JS (single-threaded event loop; async is contagious) | One blocking `Run(ctx, ...) (any, error)`, always inline on the caller's goroutine | Go blocks cheaply and has no sync/async function coloring — a promise is JS's only spelling of "wait", and `go` + channel is Go's, owned by the caller |
| `undefined`/`null` dual | Single `nil` = "no value". A map key's absence (comma-ok) is the only "missing" | Go has one zero value for interfaces. "Present but nil" is not representable — documented, not silently approximated. |
| `__proto__` inert setter | Plain `map[string]any` assignment | Go maps have no prototype chain; the attack surface does not exist. |
| Error handler return ignored; only a *throwing* handler propagates | Handler returns `error`; non-nil returns and recovered panics join the settlement error via `errors.Join` | One error channel — swallowing handler failures (DLQ writes, alerting) would be un-Go. |
| Exported error classes (#66) | Exported sentinel errors + `AbortedError` type (§6) | `errors.Is` / `errors.As` replace `instanceof`. |

## 3. Public API sketch

### 3.1 Construction

```go
run, err := superpipe.Build("checkout",
    superpipe.Deps{"db": db, "isBlocked": false},

    superpipe.Input("userId"),                                  // first positional arg → "userId"
    superpipe.Step("fetchUser", fetchUser).In("userId").Out("user"),
    superpipe.Step("charge", charge).In("user").Out("receipt"), // blocks until it has its result
    superpipe.Step("price", price).In("user").Out(Pick("subtotal", "total")),
    superpipe.Call("audit"),                                    // fn resolved from deps at run time
    superpipe.Not("isBlocked"),                                 // boolean control, inverted
    superpipe.Optional("enrich").In("user").Out("extra"),       // skipped when "enrich" is missing

    superpipe.Error("logFailure", onFailure).In("error"),       // exactly one
)
// run is an immutable *Runner; err carries every construction violation
```

The variadic definition list is Go's idiomatic spelling of multi-part construction
(`fx.Provide(...)`, gRPC dial options): one construction site, each def chaining locally
(`Step(...).In(...).Out(...)`), everything validated once at `Build`.

- `Step(name string, fn StepFunc)` — the only step type: `StepFunc func(ctx context.Context, args []any) (any, error)`.
  `args` arrives positionally in declared `In` order. The step blocks until it has its
  result; its return is the single continuation channel.
- `End(outputSpec...)` returns an immutable `*Runner` after validating: single error
  handler, no steps after it, input pipe first, all spec forms well-formed, no reserved
  output names, no shadowing of configured deps (for specs whose keys are static).

### 3.2 Spec constructors (one form, one meaning — mirrors Producer.ts)

| Constructor | TS form | Runtime behavior |
| --- | --- | --- |
| `Out("user")` | `'user'` | Binds the **whole** return value to `user`. |
| `Rename("src", "dst")` | `'src:dst'` | Binds whole return, stored as `dst`. |
| `Pick("a", "b")` | `'{a, b}'` | Return must be a map; picks named keys. A missing key throws `OutputKeyError`. |
| `Destructure("a", "b")` | `['a', 'b']` | Array return → positional binding (short array throws `OutputKeyError`); map return → picks by name (missing key throws). |
| `Merge()` | `'{...}'` | Return must be a non-array map; merges every key into the container. Other return types throw `OutputKeyError`. |

- Keys inside `Pick`/`Destructure` accept `"dst"` or `"src:dst"` spellings (rename applies).
- `...` is valid **only** as the entire `Merge()` spec. Any key spelling that targets `...`
  (`"..."`, `"...x"`, `"x:..."`) is a construction error.
- **Error-path leniency (identical to TS):** when a continuation delivers `(err, value)`
  together, the value is produced with shape checks relaxed — a malformed partial yields no
  bindings instead of throwing, so the real error surfaces. The success path never relaxes.
- **Value requirement:** `Pick`, `Destructure`, `Merge` require a non-nil return. A nil
  return on the success path throws `OutputKeyError` ("requires the pipe to return a
  value"). `Out`/`Rename`/no-spec accept nil.
- Input specs: `In("userId")` binds the first invocation arg; `In("a", "b")` binds
  invocation args positionally; `InFromObject("a", "b")` picks keys from the first arg.

### 3.3 Running

```go
out, err := run.Run(ctx, "u-123")            // blocks until settlement — instant for fully-sync pipelines
```

`Run` always executes inline on the caller's goroutine — no hidden goroutine, no
deferral (the TS "keeps fully synchronous pipelines synchronous" contract, now true of
every run). A step that blocks simply blocks the run, which is correct: the pipeline
advances one step at a time regardless. Callers who want concurrency own it: `go` plus a
channel is the Go spelling of a future, so the library ships exactly one entry point.

- `End("receipt")` → `out` is the single value. `End("a", "b")` → `out` is `[]any`.
  `EndFields("a", "b")` → `out` is `map[string]any`. `End()` → `out` is nil.
- Unknown-name fetch in the final fetcher returns the zero value (`nil`), as TS does.

### 3.4 Typed boundaries (generics policy)

Generics are used exactly where Go's type system permits them to help, and nowhere else:

- `Get[T any](args []any, i int) (T, error)` — the typed accessor for step bodies. A type
  mismatch fails with the step name, argument position, and both types; no naked
  assertions in user code. Generic *methods* only became legal in Go 1.27 (August 2026;
  interface methods still cannot declare type parameters); `Get` and the spec
  constructors (`Pick`, `Destructure`, `Merge`) stay package-level **by choice** — they
  are values passed into `Build(defs...)`, not methods on a receiver, and package-level
  spelling keeps the module usable on Go versions well below 1.27.
- The container itself stays `map[string]any` — permanently. Go's type system cannot key
  types by string names (no type-level strings, no mapped types), so a compile-time-typed
  container is not a future feature; it is impossible. And a fully typed *linear*
  pipeline needs no engine at all: `type State struct{...}` plus ordinary function calls
  already provides that, checked by the compiler. The engine earns its existence exactly
  where the wiring is dynamic — and there, declared specs plus runtime validation carry
  the safety (§8).
- Module floor: `go 1.22`, decided by the feature ladder: the hard floor is 1.20
  (`errors.Join`), 1.21 adds `slices`/`maps`/`clear` that the engine uses, and 1.22 is
  the oldest directive whose per-iteration loop-variable semantics apply to this
  module's own tests (which spawn goroutines). Nothing above 1.22 adds engine
  capability — 1.27's generic methods only re-spell what package-level generics already
  do, and its faster small allocations and `goroutineleak` profiler benefit consumers
  incidentally, by toolchain, not by requirement. A floor is inherited by every
  consumer; it tracks need, not novelty. One named cost: no `testing/synctest` in this
  module (stdlib use is gated on the `go` directive); timing tests use real channels —
  acceptable because the blocking-step engine is deterministic by construction.

## 4. Semantic contracts

Each contract is the acceptance bar. §7 maps them to tests.

**C1 — Definition shape.** Fluent construction: optional input pipe first, steps, at most
one error handler last. Steps after the error handler: construction error. A second error
handler: construction error. Input pipe after any step: construction error. The built
`*Runner` is immutable and safe for unlimited concurrent runs; every run gets fresh state.

**C2 — Dependency resolution.** For each declared input key (in order): look up the run
container first, then the configured deps, else absent. Absent key delivers `nil`. This
order lets a run output override a dep of the same name *for reads*; writing such a key is
C4's shadow error. Injected-name steps (`Call`, `Not`, `Optional`) resolve their function
the same way at execution time.

**C3 — Invocation inputs.** Input pipes map invocation args into the container per §3.2
input rules. These merges are exempt from the shadow check (they are the invocation's own
names), but not from the reserved-name check.

**C4 — Output binding.** Merging produced keys into the container enforces:
- key `next` → `OutputNameError` ("reserved").
- key equal to a configured dep name (static keys only) → `OutputNameError` ("shadows a
  configured dependency"). Merge-form keys are checked as they land.
Merge overwrites prior values; a later step may rebind any non-reserved name.

**C5 — Step execution model.**
- A step is `func(ctx context.Context, args []any) (any, error)`; it blocks until it has
  its result — doing its own I/O, spawning goroutines, `select`-ing on channels as it
  chooses. The pipeline advances one step at a time; no step starts while its predecessor
  is in flight.
- The return is the single continuation channel:
  `(value, nil)` → produce → merge → advance; `(nil, err)` → error path;
  `(value, err)` → error path, with the value produced under error-path leniency (§3.2).
  Returning `(nil, nil)` is legal data unless the spec requires a value (§3.2).
- TS's `next` callback, retained continuations, and thenable adoption have no Go spelling
  because they have no Go need: each existed to return control to a single-threaded event
  loop. The observable timeline is identical — TS's engine already pauses advancement on
  a live `next` (`pending > 0` blocks the next step); a blocked Go step pauses it the same
  way, with nothing observable in between. Two TS error classes
  (`NextCalledTwiceError`, `AmbiguousContinuationError`) become unrepresentable: the
  dual-channel misuse they guarded against cannot be written.

**C6 — Flow control.** A boolean-resolved step (`Not(...)`, or an injected boolean dep)
controls flow: `true` continues, `false` **halts** — no later step executes; the run
settles successfully with the partial snapshot once `pending` drains. `Not` inverts the
boolean **before** the decision. Booleans are ordinary data everywhere else: a `false`
returned by a normal step binds as the value `false`, sync and async alike.

**C7 — Optional steps.** `Optional(...)` is skipped (advance immediately, no bindings)
when the resolved fn is absent or any declared non-`next` input is missing from both
container and deps.

**C8 — Errors.**
- Errors reach the engine via thrown step errors (sync), rejected `Async`, or
  `next(err, ...)`.
- **First error wins** and is sticky: later errors are discarded; the run does not
  un-error. Framework errors (`OutputName`, `OutputKey`) propagate as themselves, never
  wrapped.
- **One error handler**, invoked once, with the container snapshot (copy) plus the active
  error available under the key `error` (its declared inputs resolve against that
  snapshot). `next` may not appear in its inputs — construction error. Its return value
  is ignored. A throwing/panicking handler does not re-enter error handling.
- Settlement error behavior is **uniform — one `Run`, one behavior** (a deliberate
  divergence: TS `end()` swallows the error when a handler exists — an artifact of sync
  JS having no other channel, not a designed contract):
  - the handler runs, then the caller receives the active error, wrapped with pipeline
    name and step index;
  - the handler is an observer of a failed run, not a resolver;
  - a handler's non-nil return — or a recovered panic — joins the settlement error:
    `errors.Join(activeErr, handlerErr)`; the active error stays primary;
  - the handler never runs on an aborted run (C10).
- A step that panics is recovered by the executor and routed like any thrown step error.

**C9 — Settlement.**
- The run settles when: all steps complete, a boolean halt fires, any error, or abort.
- Completions are in-band and totally ordered — each step's return *is* the continuation —
  so the microtask deferral and the trampoline exist only in TS, where completions
  arrived out-of-band and could race. First error wins and is sticky.
- The final output fetch happens under settlement: a failing fetch returns that error to
  the caller; it never hangs or deadlocks the run.

**C10 — Cancellation (the 0.16 gate, via ctx).**
- A pre-cancelled ctx aborts **before any pipe runs**: no input pipes, no steps.
- Cancellation at any later point: the run marks `aborted`; no unstarted step executes;
  an in-flight step's result is **discarded when it lands** — its value is not merged and
  its error is dropped (no handler run, no double-settle).
- The run settles with `AbortedError{Reason: context.Cause(ctx)}`. Cancellation **never**
  routes to the error handler.
- An operation already in flight is not preempted — Go cannot interrupt a running
  goroutine. Steps should pass ctx into their own I/O so they stop early; the engine's
  guarantee is about what starts and what lands, not about preempting user code.
- A run stuck on a step that ignores ctx is detectable with the `goroutineleak` pprof
  profile on Go ≥ 1.27.
- A caller blocked inside `Run` observes a mid-step abort when the in-flight step
  returns — settlement is decided at step boundaries, like any ctx-aware blocking call.
  A caller needing immediate observation runs `Run` on its own goroutine; that pattern is
  the TS `endAsync` promise-rejects-at-abort behavior.

**C11 — Stack safety.** A pipeline of 100,000 synchronous steps runs in constant stack:
the run loop is iterative; step calls are not nested through continuations.

## 5. Concurrency model

- **The definition is immutable; the run is not shared.** Every `Run` call executes on
  the caller's goroutine with its own state. No locks, no executor goroutine, no shared
  mutable state — safe for unlimited concurrent runs.
- Steps run **sequentially** on the run's goroutine. A step body may do anything — spawn
  goroutines, fan out I/O — but the *pipeline* advances one step at a time, exactly as
  SuperPipe does. Concurrent step execution is a non-goal (§8).
- Cancellation is cooperative `ctx`, as everywhere in Go: the engine gates at step
  boundaries; steps pass `ctx` into their own blocking operations so they stop early.

## 6. Error types

```go
var (
    ErrOutputName     = errors.New("superpipe: invalid output name")
    ErrOutputKey      = errors.New("superpipe: output spec mismatch")
    ErrAborted        = errors.New("superpipe: pipeline aborted")
    ErrNoErrorHandler = errors.New("superpipe: pipeline failed with no error handler")
)

type AbortedError struct{ Reason any }   // Unwrap() → ErrAborted; Reason from context.Cause
```

All engine-produced errors wrap a sentinel, so `errors.Is(err, superpipe.ErrAborted)` is
the consumer-side check (the TS-side reason consumers catch exported classes).

## 7. Test plan

Port the contract tests, mirroring `test/`:

| Go test file | Port of | Covers |
| --- | --- | --- |
| `pipeline_test.go` | `superpipe.test.mjs` | C1 construction rules |
| `parameter_test.go` | output-binding tests | §3.2 all forms, leniency, near-misses |
| `executor_test.go` | `pipeline/executor.test.mjs` | C2–C9 mechanics |
| `flow_control_test.go` | `flow-control-contract.test.mjs` (~2,700 lines) | the whole of §4; the acceptance bar |
| `abort_test.go` | endAsync abort contract + PR-54 tests | C10, including: pre-cancelled ctx runs nothing; skips unstarted steps mid-run; an in-flight step's result discarded when ctx aborts mid-step; handler never sees cancellation |
| `stack_test.go` | trampoline tests | C11 at 100k steps |

Additionally (Go-specific, from §5): `-race` on every test; concurrent `Run` calls on one
`*Runner`; a step that blocks on a channel released after abort (its value is discarded
at the step boundary). CI builds and tests against both the module floor (1.22) and the
current release (1.27) so no newer-Go idiom silently raises the requirement.

## 8. Non-goals

- No parallel step execution (would diverge from SuperPipe's sequential semantics).
- No typed/generic container — not deferred: **impossible and unnecessary**. Go cannot
  key types by string names, and a fully typed pipeline degenerates to plain
  struct-threading function calls that need no engine. Generics live at the boundaries
  only (§3.4).
- No string expression language for logic (CEL-style transforms belong to the host app).
- No browser/UMD concerns.

## 9. Resolved decisions

1. **`Next` is a named func type** — `type Next func(err error, value any)` — delivered
   as the dedicated third parameter of `AsyncStepFunc`. *Superseded by decision 4: with
   `next` itself removed, this type no longer exists.*
2. **One blocking `Run` — and no `RunAsync`.** `Run` drives the loop inline on the
   caller's goroutine. Callers who want a future wrap `Run` in a goroutine themselves;
   the `Async` suffix is a C#/JS convention with no place in a Go API. Error behavior is
   uniform (C8).
3. **Error handler returns an error.** `func(ctx context.Context, args []any) error`;
   a non-nil return — or a recovered panic — is joined onto the settlement error with
   `errors.Join(activeErr, handlerErr)`. TS surfaces a *throwing* handler; Go surfaces
   both panics and returned errors — swallowing either would be un-Go.
4. **No `next` callback — steps block.** `next` is the callback-era artifact: it existed
   to hand control back to a single-threaded event loop, and the CLAUDE.md describes the
   TS architecture as continuation-passing style for exactly that reason. Go blocks, so
   the step's return is the only continuation channel, and `StepAsync`/`Async` disappear
   with it. Pipeline semantics are unchanged — TS advancement already pauses on a live
   `next` (`pending > 0`), which a blocked step reproduces exactly — and two error
   classes (`ErrNextCalledTwice`, `ErrAmbiguousContinuation`) become unrepresentable.
   This supersedes decision 1.
5. **Generics at the boundaries; definition-list construction.** `Build(name, deps,
   defs...)` replaces the TS fluent chain as the primary constructor (local `.In`/`.Out`
   chaining survives on each def); `Get[T]` is the typed accessor for step bodies. The
   container stays `map[string]any` permanently — string-keyed typing is outside Go's
   type system, and full static typing would eliminate the need for the engine.
   (Correction: an earlier draft justified package-level constructors by "methods cannot
   take type parameters" — true through Go 1.26, repealed by Go 1.27's generic methods.
   The package-level choice stands on its own merits; module floor is `go 1.22`.)
