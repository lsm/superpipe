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
| JS single-threaded run-to-completion | Every `Run` executes inline on the caller's goroutine; completions are in-band step returns, so settlement needs no concurrency control at all | The 0.16 cancellation design leaned on single-threaded settlement; in-band returns make the concern vanish rather than needing an equivalent |
| `end()` / `endAsync()` — two entry points; a blocking `end()` is impossible in JS (single-threaded event loop; async is contagious) | One blocking `Run(ctx, ...) (any, error)`, always inline on the caller's goroutine | Go blocks cheaply and has no sync/async function coloring — a promise is JS's only spelling of "wait", and `go` + channel is Go's, owned by the caller |
| `undefined`/`null` dual | `nil` is the one no-value, and **presence is representable**: comma-ok distinguishes present-with-nil from absent | Container membership and output merging are presence-based in TS (own keys; a present-`undefined` value binds); Go carries that with comma-ok. Input lookup returns the value either way; the optional-step skip check stays value-based (nil or absent both count unresolved), matching TS `hasUnresolved`. |
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

    superpipe.Output("receipt"),                                 // runner output spec
)
// run is an immutable *Runner; err carries every construction violation
```

The variadic definition list is Go's idiomatic spelling of multi-part construction
(`fx.Provide(...)`, gRPC dial options): one construction site, each def chaining locally
(`Step(...).In(...).Out(...)`), everything validated once at `Build`.

- `Step(name string, fn StepFunc)` — the only step type: `StepFunc func(ctx context.Context, args []any) (any, error)`.
  `args` arrives positionally in declared `In` order. A step with **no** `.In` receives
  the invocation args verbatim (TS `fetchNothing` — test *passes the invocation arguments
  to pipes that declare no inputs*): `Run(ctx, 1, 2)` delivers `args == []any{1, 2}`.
  The step blocks until it has its result; its return is the single continuation channel.
- `Build` returns an immutable `*Runner` after validating: single error handler, no
  steps after it, input pipe first, all spec forms well-formed. **Reserved output names
  and dependency shadowing are not construction checks** — both are enforced at merge
  time, when the produced output lands against that run's live `Deps` map (C4): the
  reference builds a runner with a reserved output name and raises `OutputNameError`
  only at run (tests *throws when a declared output writes the reserved name next* and
  *throws when an invocation input writes the reserved name next*).
- `Not` and `Optional` **compose** on injected boolean control:
  `Optional(Not("check"))` is the optional inverted-boolean step (TS `!?check`) —
  skipped when unresolved, inverted when present. `Optional` accepts a name or a
  `Not(...)` def. (TS strips `!` then `?`, so only the `!?` order composes; `?!check`
  strips the `?` and leaves a dep literally named `!check` — a quirk the sigil-free Go
  spelling cannot reproduce by accident and does not port.)
- `ErrorCall(name string)` — the injected form of `Error`: the handler is resolved by
  name **at error time**, run container first then `Deps` (TS string-named error
  handlers, builder.ts:77-85); the resolved callable must match `ErrorHandlerFunc`'s
  signature exactly, under the same C2 policy and `ErrDependency` failure. It still
  counts as the pipeline's single error handler.
- The runner's **output spec is a definition** — `superpipe.Output(...)` among the defs
  (conventionally last). Without one, `Run` returns nil (TS `end()` with no spec).

### 3.2 Spec constructors (one form, one meaning — mirrors Producer.ts)

| Constructor | TS form | Runtime behavior |
| --- | --- | --- |
| `Out("user")` | `'user'` | Binds the **whole** return value to `user`. |
| `Rename("src", "dst")` | `'src:dst'` (bare) | **A one-key pick, not a whole-value bind**: return must be a map; picks key `src`, binds it as `dst`; missing `src` throws `OutputKeyError` (Producer.ts:69-71 classifies a bare rename as the pick form). |
| `Pick("a", "b")` | `'{a, b}'` | Return must be a map; picks named keys. A missing key throws `OutputKeyError`. |
| `Destructure("a", "b")` | `['a', 'b']` | Array return → positional binding (short array throws `OutputKeyError`); map return → picks by name (missing key throws). |
| `Merge()` | `'{...}'` | Return must be a non-array map; merges every key into the container. Other return types throw `OutputKeyError`. |

- Keys inside `Pick`/`Destructure` accept `"dst"` or `"src:dst"` spellings (rename applies).
- `...` is valid **only** as the entire `Merge()` spec. Any key spelling that targets `...`
  (`"..."`, `"...x"`, `"x:..."`) is a construction error.
- **Error-path leniency (identical to TS):** when a step returns `(value, err)` together,
  the value is produced with shape checks relaxed — a *structurally compatible* partial
  binds its available entries and binds missing entries as present-with-nil (TS binds
  them as present-with-`undefined`); only a structurally incompatible return (a scalar
  against `Rename`/`Pick`/`Destructure`; an array or scalar against `Merge`) yields no
  bindings. The success path never relaxes.
- **Value requirement:** `Rename`, `Pick`, `Destructure`, `Merge` all require a non-nil
  return — every one is a picking/merging form, and `expectValue` exempts only the single
  and none forms. A nil return on the success path throws `OutputKeyError` ("requires
  the pipe to return a value"). `Out`/no-spec accept nil — and a nil return creates **no
  bindings**: the step advances and any prior value for its output names persists.
- Invocation-input specs (the `Input` **def** — not a step's `.In`, which declares
  container inputs): `Input("userId")` binds the first invocation arg;
  `Input("a", "b")` binds invocation args positionally; `InputFromObject("a", "b")`
  picks keys from the first arg. Every requested name is **always bound** — a missing
  positional arg, or a nil/absent object source, binds present-with-nil, never a panic
  or an error (test *maps an absent object-string input argument to undefined values*).
- Step inputs have an object form: `.InFields("error", "key1")` resolves each name per
  C2 and delivers **one** `map[string]any` argument containing them (TS object-string
  inputs — test *delivers a result value alongside an error to the handler inputs*),
  instead of positional args. Valid on `Error`/`ErrorCall` defs too, where the TS form
  is most common.
- **Collection typing (Go-specific):** "map" means any non-nil map with string keys,
  "array" any non-nil slice or array — element types are irrelevant (values land in the
  container as `any`; named collection types included; judged by underlying kind, so an
  implementation must not require `map[string]any`/`[]any` exactly). A nil map or slice
  is **no value** for the value-requirement rule — not an empty collection. Structs are
  not maps: a struct return against a pick/destructure/merge spec is a shape error;
  bind structs with `Out`.

### 3.3 Running

```go
out, err := run.Run(ctx, "u-123")            // blocks until settlement — instant for fully-sync pipelines
```

`Run` always executes inline on the caller's goroutine — no hidden goroutine, no
deferral (the TS "keeps fully synchronous pipelines synchronous" contract, now true of
every run). A step that blocks simply blocks the run, which is correct: the pipeline
advances one step at a time regardless. Callers who want concurrency own it: `go` plus a
channel is the Go spelling of a future, so the library ships exactly one entry point.

- `Output("receipt")` → `out` is the single value. `Output("a", "b")` → `out` is
  `[]any`. `OutputFields("a", "b")` → `out` is `map[string]any`. No `Output` def → `out`
  is nil.
- Final-output resolution uses the same lookup as C2 — the run container first, then
  `Deps`: `Output("config")` with no step producing `config` returns the configured
  dependency (test `resolves .end(output) from configured dependencies`). A name absent
  from both returns `nil`.

### 3.4 Typed boundaries (generics policy)

Generics are used exactly where Go's type system permits them to help, and nowhere else:

- `Get[T any](args []any, i int) (T, error)` — the typed accessor for step bodies. A type
  mismatch fails with the argument position and both types; the step and pipeline context
  arrive via the engine's error wrapping (C8), since a `Get` failure is an ordinary error
  returned from the step. No naked assertions in user code. Generic *methods* only became legal in Go 1.27 (August 2026;
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

**C1 — Definition shape.** Zero or more input defs first — all before the first step,
accumulating (test `accumulates multiple input declarations` maps the same invocation
args through two input defs) — then steps, at most one error handler last. The `Output`
def may appear **anywhere** among the definitions (conventionally last); definitions
after it are still collected and execute — TS tuples after an `end` tuple still process
(test `processes tuples that follow an explicit end tuple`). Repeated `Output` defs are
allowed and the **last wins**, including a bare `Output()` resetting the final output to
none (index.ts:23-24 assigns per `end` tuple). Steps after the error
handler: construction error. A second error
handler: construction error. An input def after any step: construction error. The built `*Runner`'s definition is immutable; concurrent runs are
safe under the §5 `Deps` rule; every run gets fresh state.

**C2 — Dependency resolution.** For each declared input key (in order): look up the run
container first, then the configured deps, else absent. Absent key delivers `nil`. This
order lets a run output override a dep of the same name *for reads*; writing such a key is
C4's shadow error. Injected-name steps (`Call`, `Not`, `Optional`) resolve their function
the same way at execution time. A resolved callable must have **exactly `StepFunc`'s
signature** — `func(context.Context, []any) (any, error)`; a named type with that
underlying signature is accepted and converted (Go function types are not
interchangeable, so no reflection/adaptation of arbitrary signatures exists). A bool
remains a valid injected value — it is the C6 flow-control case, never invoked. An
injected step that resolves to a present **non-nil** invalid value (a non-callable
non-bool, or a callable of any other signature) fails the run **before invocation**
with a `Dependency "<name>" is not a valid step function` error: framework-error class
(C8), unwrapped, never routed to the error handler — **`Optional` included**
(executor.ts:249: the optional skip tests `fn === undefined`; a present invalid value
still throws). Absent, **plain nil**, and **typed nil** all count as unresolved — a Go
nil interface is TS `undefined`, and an invocation input can write a present nil over a
configured callable (§3.2): `Optional` skips; a non-`Optional` step fails with the same
`ErrDependency` error before invocation. (A typed-nil callable — a func value that is
nil after conversion, non-nil as an interface but uninvocable — would otherwise panic;
JS cannot express it, so the port defines the case.)

**C3 — Invocation inputs.** Input pipes map invocation args into the container per §3.2
input rules. These merges are exempt from the shadow check (they are the invocation's own
names), but not from the reserved-name check.

**C4 — Output binding.** Merging produced keys into the container enforces:
- key `next` → `OutputNameError` ("reserved") — a **merge-time** check on every produced
  key, statically declared or `Merge()`-dynamic alike; construction does not reject
  reserved destinations (executor.ts:109-113).
- key equal to a **live** configured dep name → `OutputNameError` ("shadows a configured
  dependency"). All shadow checks — static and merge-form keys alike — run when the
  produced output **lands**, against that run's `Deps` map: a name added to `Deps` after
  `Build` shadows retroactively; one removed before `Run` no longer does
  (executor.ts:108-120, consistent with §5's live `Deps`).
Merge overwrites prior values; a later step may rebind any non-reserved name.

**C5 — Step execution model.**
- A step is `func(ctx context.Context, args []any) (any, error)`; it blocks until it has
  its result — doing its own I/O, spawning goroutines, `select`-ing on channels as it
  chooses. The pipeline advances one step at a time; no step starts while its predecessor
  is in flight.
- The return is the single continuation channel:
  `(value, nil)` with non-nil value → produce → merge → advance. `(nil, nil)` → advance
  **without producing bindings**: a nil return creates no bindings, and any prior value
  bound to the step's output names persists (TS: the `value != null` merge guard,
  executor.ts:461-471). `(nil, err)` → error path. `(value, err)` → the value is
  produced and merged **first** (shape leniency per §3.2, reserved/shadow checks still
  enforced), then the error is recorded and routed — so an output-name violation in a
  partial escapes as a framework error and beats the returned error
  (executor.ts:461-475).
- TS's `next` callback, retained continuations, and thenable adoption have no Go spelling
  because they have no Go need: each existed to return control to a single-threaded event
  loop. The observable timeline is identical — TS's engine already pauses advancement on
  a live `next` (`pending > 0` blocks the next step); a blocked Go step pauses it the same
  way, with nothing observable in between. Two TS error classes
  (`NextCalledTwiceError`, `AmbiguousContinuationError`) become unrepresentable: the
  dual-channel misuse they guarded against cannot be written.

**C6 — Flow control.** A boolean-resolved step (`Not(...)`, or an injected boolean dep)
controls flow: `true` continues, `false` **halts** — no later step executes; the run
settles successfully with the partial snapshot immediately (in-band returns leave
nothing in flight). A halting `false` **creates no output bindings**: the producer
never runs (executor.ts:392-402 branches before advancing), so prior bindings for the
step's output names persist. `Not` inverts the boolean **before** the decision. Booleans are
ordinary data everywhere else: a `false` returned by a normal step binds as the value
`false`.

**C7 — Optional steps.** `Optional(...)` is skipped (advance immediately, no bindings)
when the resolved fn is absent, plain nil, or a typed nil (C2), or when any declared
input resolves to nil-or-absent in both container and deps (value-based, matching TS
`hasUnresolved`). The skip test — fn unresolved **or any declared input unresolved** —
is evaluated **before** dependency-type validation: `Optional("handler").In("missing")`
with `handler = 42` and `missing` absent skips rather than failing, because the
combined guard at executor.ts:249-252 runs before callable validation.

**C8 — Errors.**
- Errors reach the engine as a step's non-nil error return, including recovered panics.
- **First error wins** and is sticky: later errors are discarded; the run does not
  un-error. Framework errors (`OutputName`, `OutputKey`) are **definition errors**: they
  propagate as themselves, never wrapped, and **never route to the error handler** — the
  handler is reserved for runtime (step) failures (TS: a `{...}` shape violation throws
  on the invoking stack with the handler unrun).
- **One error handler**, invoked once, with the container snapshot (copy) plus the active
  error available under the key `error` (its declared inputs resolve against that
  snapshot). An `Error(...)` def with **no** `.In` defaults to a single input: the active
  error (builder.ts:68-70; test *should trigger error when calling next with error*).
  The handler itself may be injected — `ErrorCall("<name>")` resolves it by name at
  error time, container first then `Deps`; a resolution failure or signature mismatch
  **joins** the settlement error — `errors.Join(activeErr, lookupErr)`, exactly like a
  handler's own failure — so the active error stays primary and `errors.Is` finds
  either.
  A non-nil handler return — or a recovered panic — joins the settlement
  error (below); it is never ignored. A failing handler does not re-enter error handling.
- Settlement error behavior is **uniform — one `Run`, one behavior** (a deliberate
  divergence: TS `end()` swallows the error when a handler exists — an artifact of sync
  JS having no other channel, not a designed contract):
  - with or without a handler, the caller receives the active error, wrapped with
    pipeline name and step index (with a handler, the handler runs first);
  - the handler is an observer of a failed run, not a resolver;
  - a handler's non-nil return — or a recovered panic — joins the settlement error:
    `errors.Join(activeErr, handlerErr)`; the active error stays primary;
  - the handler never runs on an aborted run (C10).
- A step that panics is recovered by the executor and routed like any thrown step error.
  A recovered value that is an `error` routes as itself; any other value is converted
  to an error wrapping `ErrPanicked`, carrying the step name and the panic value —
  `panic("boom")` becomes a step error carrying `"boom"` — mirroring TS's falsey-throw
  wrap (`err || new Error('Pipe threw a falsey value')`). The same conversion applies
  to handler panics before `errors.Join`.

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
- **Porting note** (TS contract: *rejects with `PipelineAbortedError` while a pipe's
  promise never settles*): a step that ignores ctx and never returns keeps a blocking
  `Run` blocked indefinitely — the same as any Go call that blocks without ctx, and
  untestable by construction in blocking form. The contract ports as: the step is
  ctx-aware, returns after the abort, and its result is discarded; `Run` then settles
  with `AbortedError`. Serving the literal never-settling case would require `Run` to
  abandon the caller, contradicting the blocking design (decision 2) — a caller who
  needs that behavior wraps `Run` in a goroutine and abandons it, stranding the goroutine
  exactly as TS strands the abandoned run.

**C11 — Stack safety.** A pipeline of 100,000 synchronous steps runs in constant stack:
the run loop is iterative; step calls are not nested through continuations.

## 5. Concurrency model

- **The definition is immutable; the run is not shared.** Every `Run` call executes on
  the caller's goroutine with its own state. No locks, no executor goroutine, no shared
  mutable state between runs — safe for unlimited concurrent runs (under the `Deps`
  rule below).
- **`Deps` is retained live, not copied.** The runner holds the caller's map by
  reference; mutations between runs are observed by subsequent runs (TS parity: the
  build copies the step arrays but not `functions` — Pipeline.ts:77-83; the contract
  test *sees dependency updates made after the executor was built*). Mutating the map
  concurrently with an active run is a data race and forbidden — synchronize mutations
  between runs, as with any shared Go map. "Immutable runner" covers the definition
  (steps, specs, handler), never the deps map.
- Steps run **sequentially** on the run's goroutine. A step body may do anything — spawn
  goroutines, fan out I/O — but the *pipeline* advances one step at a time, exactly as
  SuperPipe does. Concurrent step execution is a non-goal (§8).
- Cancellation is cooperative `ctx`, as everywhere in Go: the engine gates at step
  boundaries; steps pass `ctx` into their own blocking operations so they stop early.

## 6. Error types

```go
var (
    ErrOutputName        = errors.New("superpipe: invalid output name")
    ErrOutputKey         = errors.New("superpipe: output spec mismatch")
    ErrAborted           = errors.New("superpipe: pipeline aborted")
    ErrDependency        = errors.New("superpipe: dependency is not a valid step function")
    ErrInvalidDefinition = errors.New("superpipe: invalid pipeline definition")
    ErrPanicked          = errors.New("superpipe: step panicked")
)

type AbortedError struct{ Reason any }   // Unwrap() → ErrAborted; Reason from context.Cause
```

Sentinel coverage: reserved/shadowed output names wrap `ErrOutputName`; spec/return
shape failures wrap `ErrOutputKey`; cancellation is `AbortedError` → `ErrAborted`; the
C2 dependency-resolution failure wraps `ErrDependency`; every construction violation
returned by `Build` wraps `ErrInvalidDefinition`; a converted non-error panic wraps
`ErrPanicked` (an `error`-valued panic routes as itself, wrapping whatever it wraps).

There is deliberately **no** `ErrNoErrorHandler`: settlement is uniform (C8), so a failed
run returns the active error whether or not a handler ran — there is no separate
no-handler outcome to name. The TS `Pipeline error: ...` wrapper exists only to convert
non-`Error` throwables, which Go cannot have.

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
