Unreleased
==========
- Opt-in `result:<name>` outputs add a structural Result protocol. `{ value }`
  binds the value and continues; `{ reason }` binds the reason and halts as a
  successful business outcome. Sync `.end(output)` and `.endAsync(output)`
  return the terminal reason, while thrown errors and `next(error)` retain
  their existing error-channel behavior. Ordinary data, including an `error`
  property, remains ordinary data.

0.17.0 2026-08-19
=================
- **Output binding grammar:** a pipe's output spec now decides how its
  return value is stored, independent of the value's runtime type. A
  single name (`'out'`) binds the whole return value; `'{a, b}'` picks
  named properties; `['a', 'b']` destructures (positional for array
  returns, by name for objects); `'{...}'` (new) merges every key of a
  returned object; a missing spec means effects only.
- **Output validation:** destructure output specs check what they name —
  a pick naming a key the returned object does not have throws
  `OutputKeyError` at the producing pipe (deliberate break: previously
  stored `undefined` silently), a positional spec exceeding an array
  return throws, and any destructure spec receiving a return it cannot
  destructure (a list or pick against a primitive — one output name or
  many) is a spec/return mismatch that throws instead of storing
  nothing, and a pipe that owns no `next` but returns nothing (a bare
  return, or a promise resolving to nullish) fails the same way —
  `next()` deliveries stay exempt as the protocol's explicit
  nothing-to-merge. Presence, not truthiness, is the contract — a
  present-but-`undefined` key binds fine and prototype-inherited keys
  count. Partial values delivered with an error (`next(error,
  partialValue)`) merge leniently, shape mismatches included, so a
  partial can never mask the real error. The modernized form of 0.14's
  `supplies` contract.
- **Behavior of output mapping (deliberate break):** a single output name
  no longer property-picks object returns or takes only the first element
  of array returns — it binds the whole value (use `'{name}'` to pick a
  property, `['name']` for positional). A pipe without an output spec now
  discards its return value instead of implicitly spreading a plain
  object into the store — declare `'{...}'` to keep the merge. Brace
  specs never switch to positional mapping for array returns, and a
  one-name list spec (`['first']`) stores nothing for a non-structural
  return instead of the whole value. Near-miss spellings of the merge
  form (`'{a, ...}'`, `'{...rest}'`, a bare `'...'`) are rejected at
  construction instead of storing a literal `...` key.

0.16.0 2026-08-18
=================
- `.endAsync(output)` — a promise-returning `.end()` for async pipelines.
  Resolves with the output (or partial snapshot on a flow-control halt),
  rejects with the active error on failure. Sync `.end()` is unchanged;
  fully-sync pipelines resolve immediately under `.endAsync()`.
- Per-run cancellation: the runner returned by `.endAsync()` exposes
  `withSignal(signal, ...args)`, binding one AbortSignal to one execution.
  Aborting rejects that run's promise with PipelineAbortedError and leaves
  the runner reusable; concurrent runs cancel independently.
- Stack safety: the synchronous pipe cascade is trampolined. Pipelines of
  any length run in O(1) stack (previously RangeError at ~2,000 sync pipes);
  async pipes were already safe.
- Thenable returns are sugar for `next`: a pipe that does not declare `next`
  may return a promise — resolution continues the pipeline, rejection routes
  to the error handler. Returning a thenable from a pipe that also declares
  `next` throws AmbiguousContinuationError. Fully synchronous pipelines stay
  synchronous.
- Contract change: `false` returned from a pipe function is ordinary data —
  it is stored under the output name and the pipeline continues. Boolean
  flow control lives only on the declarative channels (raw boolean
  dependencies and `!`-prefixed pipes).
- Contract change: a pipe result or output named `error` is ordinary data
  and no longer fires the error handler; the active error travels on
  execution state instead of the dependency container.
- Stricter namespace validation: outputs (declared, renamed, or merged) and
  invocation inputs named `next` throw, as do pipe outputs that collide with
  a configured dependency name (OutputNameError). Invocation inputs may
  still deliberately override a configured dependency.
- Public contracts are `any`-free: PipeResult and PipeOutput are `unknown`,
  AnyFunction uses `never[]` parameters, and PipeRename / PipeName are
  exported. `Function` remains in the PipeFunction union for compatibility.
- Toolchain: Vitest 4 replaces mocha/chai/nyc; tsdown (rolldown) replaces
  tsc+Babel+Rollup (one config emits CJS, ESM, .d.ts, .d.mts plus the
  superpipe.js / superpipe.min.js browser bundles); Biome replaces ESLint 8;
  TypeScript 7.0.2 (native port). Standards-compliant `exports` map with
  per-condition types — Node ESM consumers now resolve real ESM.
- CI: coverage badge published to the badges branch, HTML report uploaded
  as a workflow artifact; publint + attw package lint gate.

0.15.0 2026-08-14
=================
- New internal architecture: pipeline decomposed into builder / executor /
  parameter (Fetcher, Producer) modules with independent tests.
- Flow-control parity with the documented contract: `false` halts a pipeline,
  `!` inverts boolean results, `?` marks optional pipes (prefix), and raw
  boolean dependencies act as flow control.
- Input/output resolution now matches master's semantics: configured
  dependencies resolve as pipe inputs, no-input pipes receive the invocation
  arguments, arrays map positionally, objects map by property name, and
  plain-object returns merge when no output is declared.
- `.end(output)` can return a value (synchronous pipelines only);
  `.end()` without an output returns `undefined`.
- `source:destination` output renaming and `{a, b}` object-string syntax.
- Duplicate-`next` detection is bound per pipe (NextCalledTwiceError); a
  stale `next` from an earlier pipe can no longer skip a waiting one.
- Unhandled `Error` instances propagate as-is; non-Error failures are
  wrapped in an Error. An `error` property merged from a pipe result routes
  to the error handler.
- Multiple `.input()` declarations accumulate; `.pipe('input', ...)` and
  `.pipe('error', ...)` reserved forms restored; the configured dependency
  container is live (mutations after `.end()` are visible).
- Toolchain modernized: exact-pinned devDependencies (typescript 5.9,
  babel 7.29, rollup 4, mocha 11), Node >= 18, GitHub Actions CI,
  CircleCI on Node 20/22/24, callable UMD global.
- Compatibility type exports: Dependencies, PipelineAPI, Pipeline, Pipe,
  PipeState, Store, SuperPipeFactory, PipelineDefinition.

0.10.3 2016-03-23
=================
- Superpipe instance is completely optional when executing pipelines.
- Call pipeline instance with superpipe instance equals to clone and connect to
that superpipe before pipeline execution.
- Reorganize dependency management functions to `lib/dep.js`.
- Add support for `NOT` pipe:
  `.pipe('!willStopWhenReturnsTrue')`

0.10.0 2016-02-29
=================
- Add `clone` method to Pipeline instance.

0.10.1 2016-02-27
=================
- Do not catch exceptions for pipeline executions.
- Put error function body to dependency `errPipeBody` if possible.

0.10.0 2016-02-25
=================
- Name of error pipe can be retrived by dependency `errPipeName` in the error handler.
- `setDep` can be called through `next.setDep` to reduce the number of arguments
needed for pipe functions when both `next` and `setDep` are required.


0.9.0 2016-01-12
================
- Call `Superpipe` constructor directly returns a new Pipeline instance.
- Class `Pipeline` can be used without Superpipe.
- New prototype methods for Pipeline:
  - `push` is a unified interface for adding pipes to pipeline.
  - `seal` can seal the pipeline which prevent adding more pipes to it.
  - `toCurriedPipe` converts a pipeline into a curry function which connect an
  instance of Superpipe or Injector with the pipeline and returns it. (Later binding)
- Pipeline now returns a function as its instance when initialized/called.

0.8.0 2015-12-15
================
- Upgrade `insider@0.4.0`
- Put number as the first element of dependencies array to indicate the number of
default arguments you want to feed to the piped function.

0.7.1 2015-11-17
================
- Use `#pipe('emit', 'event name', deps)` to emit events.

0.7.0 2015-11-17
================
More strict api.
- `#pipe` only accepts three arguments: `function`, `dependencies` and `supplies`
- New signature `#listenTo('emitterName', eventName)` which allows listen
an emitter which can be found from dependencies (now or later).

0.6.0 2015-10-25
================
- Fully compatible with IE 6/7/8/9.

0.5.0 2015-10-13
================
- `Pipeline.trigger`, `Pipeline.toTrigger` and `Pipeline.emitter` have been removed
- `SuperPipe.listenTo` and `Pipeline.listenTo` use instance of superpipe
as emitter if only event name is provided.

0.4.0 2015-09-23
================
- `#pipe` now accepts number as millisecond for throttling event stream

0.3.0-3 2015-09-16
================
- Bug fix for error handler not getting error object.
- Fix an issue when works with jspm.

0.2.0 2015-05-06
================

- No `this` for piped function.
- Use `next` as error trigger.
- Supprt dependency injection for error handler.


0.1.0 2015-05-04
================

- Initial release.
