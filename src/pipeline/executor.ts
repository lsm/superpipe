import {
  type AbortSignalLike,
  AmbiguousContinuationError,
  type AnyFunction,
  type EndAsyncOptions,
  type FunctionContainer,
  NextCalledTwiceError,
  OutputNameError,
  type PipelineBase,
  type PipeOutput,
  type PipeResult,
  throwNoErrorHandlerError,
} from '../common'
import type { NextCallback, NextCallbacks } from '../parameter/Fetcher'
import type Pipe from './Pipe'

// Hold synchronous `next` invocations until the pipe's return channel is
// known: a pipe that both calls `next` and returns a thenable must not
// advance the pipeline before the ambiguity is detected.
function holdNextCallbacks(callbacks: NextCallbacks): void {
  callbacks.holding = true
}

// Release held invocations in the order the pipe made them — two declared
// `next` callbacks flush in call order, not declaration order.
function flushNextCallbacks(
  state: PipeState,
  pipeline: PipelineBase,
  next: Continuation,
  callbacks: NextCallbacks,
): void {
  callbacks.holding = false
  while (callbacks.held.length > 0) {
    const held = callbacks.held.shift()
    if (held) {
      next(state, pipeline, held.error, held.value, callbacks.pipeIndex)
    }
  }
}

// Void the callbacks and discard any held invocation and its payload — used
// when the executor rejects an ambiguous or unobservable continuation.
function invalidateNextCallbacks(callbacks: NextCallbacks): void {
  for (const wrapper of callbacks.wrappers) {
    wrapper.disable()
  }
  callbacks.held.length = 0
}

interface ResultContainer {
  [key: string]: PipeResult
}

// Terminal report handed to a run's completion observer exactly once. `error`
// is the active error (null for completed/halted/aborted); `aborted` marks a
// signal cancellation distinct from a failure; `reason` carries the signal's
// abort reason.
export interface RunOutcome {
  container: ResultContainer
  error: Error | null
  aborted: boolean
  reason?: unknown
}

export type SettlementObserver = (outcome: RunOutcome) => void

// Typed continuation view: AnyFunction's `never[]` parameters maximize
// assignability, but invoking the continuation needs a concrete signature.
// `fromStep` names the pipe a continuation's value belongs to — an adopted
// promise may settle after the step counter advanced past its pipe.
type Continuation = (
  state: PipeState,
  pipeline: PipelineBase,
  error?: Error | null,
  value?: PipeResult,
  fromStep?: number,
) => void

// Typed error-handler view, same reasoning as Continuation.
type ErrorHandler = (
  container: ResultContainer,
  functions: FunctionContainer,
  error?: Error,
) => void

// Control fields live in the container under reserved names; a pipe output
// (or invocation input) writing one must fail loudly rather than silently
// break continuation.
const RESERVED_OUTPUT_NAMES = ['next']

// Dependency resolution reads through the prototype chain (plain property
// access), so a class-based or Object.create container exposes inherited
// names. Detect collisions with the same semantics, but stop at the standard
// Object.prototype — its built-ins are not user-configured dependencies.
function hasConfiguredDependency(
  functions: FunctionContainer,
  key: string,
  isSettled?: () => boolean,
): boolean {
  let obj: unknown = functions
  while (obj != null) {
    if (obj === Object.prototype) return false
    if (Object.prototype.hasOwnProperty.call(obj, key)) return true
    // Metadata traps on a Proxy container may abort the run mid-walk: check
    // both after the presence probe and after the prototype read, so no
    // later trap runs once the run has settled.
    if (isSettled?.()) return false
    obj = Object.getPrototypeOf(obj)
    if (isSettled?.()) return false
  }
  return false
}

// Sink that assimilates any value — a nested rejected promise resolved by a
// cleanup path would otherwise die as an unhandled rejection.
function swallow(value: unknown): void {
  Promise.resolve(value).then(
    () => {},
    () => {},
  )
}

// Rejection reasons are opaque values, never assimilated: invoking a
// then-looking reason's `then` would run arbitrary side effects during
// cleanup.
function ignoreReason(): void {}

// Attempt to observe a native promise's rejection through the intrinsic
// then, reporting whether a reaction actually attached. The attach is
// attempted directly and an incompatible receiver — a non-promise object,
// a branded-looking but slotless value, a Proxy of any kind — throws
// before running an observable trap, unlike an `instanceof` brand check
// whose getPrototypeOf read would run a Proxy's user code. The intrinsic
// reaches a promise's original state regardless of any `then` override; a
// species constructor that throws when constructed makes the attach throw
// before registering anything — and no userland mechanism can observe such
// an object (only the engine's internal species-free path, used by `await`,
// can).
export function observeOriginalRejection(value: PipeResult): boolean {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return false
  }
  try {
    Reflect.apply(Promise.prototype.then, value, [swallow, ignoreReason])
    return true
  } catch {
    return false
  }
}

// Merge a produced result into the container. Reserved control names throw
// for both inputs and outputs. Shadowing throws for pipe outputs — mid-flight
// collisions with a configured dependency are accidents, and the container-
// first lookup would make them silent and permanent. Invocation inputs may
// deliberately override a configured dependency, so they are allowed.
function mergeIntoContainer(
  state: PipeState,
  pipeline: PipelineBase,
  step: number,
  fnName: string,
  produced: PipeOutput,
  isInvocationInput: boolean,
): void {
  const source = produced as Record<PropertyKey, PipeResult>
  // Enumerate the mergeable keys once and carry them through: the namespace
  // checks below see exactly the keys the copy would write (own enumerable
  // string and symbol keys, in specification order), and a Proxy's metadata
  // traps are never re-run by the copy. A trap that aborts the run stops the
  // enumeration before any value is read.
  const allKeys = Reflect.ownKeys(source)
  if (state.settled) {
    return
  }
  const enumerable: PropertyKey[] = []
  for (const key of allKeys) {
    if (Object.getOwnPropertyDescriptor(source, key)?.enumerable === true) {
      enumerable.push(key)
    }
    if (state.settled) {
      return
    }
  }
  // Names are validated before any value is read: an invalid output such as
  // `{ next, get sideEffect() { ... } }` must throw before user code runs.
  for (const key of enumerable) {
    if (typeof key !== 'string') {
      continue
    }
    if (RESERVED_OUTPUT_NAMES.includes(key)) {
      throw new OutputNameError(
        `Pipeline [${pipeline.name}] step [${step}|${fnName}] : Output name "${key}" is reserved.`,
      )
    }
    if (
      !isInvocationInput &&
      hasConfiguredDependency(pipeline.functions, key, (): boolean => state.settled)
    ) {
      throw new OutputNameError(
        `Pipeline [${pipeline.name}] step [${step}|${fnName}] : Output name "${key}" shadows a configured dependency of the same name.`,
      )
    }
    // Dependency metadata traps may have aborted the run mid-validation;
    // stop before later names or any value read.
    if (state.settled) {
      return
    }
  }
  // Values are copied one key at a time after validation: a getter that
  // aborts the run stops the merge before later accessors run.
  const container = state.container as Record<PropertyKey, PipeResult>
  for (const key of enumerable) {
    container[key] = source[key]
    if (state.settled) {
      return
    }
  }
}

interface PipeState {
  step: 0
  container: ResultContainer
  // Wrapped invocation arguments, supplied to pipes that declare no inputs.
  args: PipeResult[]
  // The active error travels on the execution state, never the container —
  // a data value named `error` must not be mistaken for a failure.
  activeError: Error | null
  // True while an error handler (or the no-handler rethrow) is unwinding —
  // such exceptions must not be treated as fresh pipe errors.
  handlingError: boolean
  // True once the run reached a terminal state — every pipe executed, a
  // flow-control halt fired, or an error was dispatched. Exactly one
  // terminal transition reports to `onSettled`.
  settled: boolean
  // True while a success settlement is queued: success is deferred by one
  // job so an error dispatched during the same synchronous unwind (a held
  // next flushed from a throwing pipe's catch) wins over it.
  settling: boolean
  // Adopted promise continuations still in flight. Reaching the end of the
  // pipes is not completion while one is pending — with duplicate `next`
  // inputs, a later callback can advance past a pipe whose promise has
  // not settled yet.
  pending: number
  // True once a flow-control halt ended progression. Late sibling
  // continuations still merge their own outputs, but no further pipes
  // run — the run settles with the partial snapshot.
  halted: boolean
  // Every live (not-yet-consumed) `next` wrapper created this run, so an
  // abort can disable them all. Bounded by the run's wrapper count and
  // cleared on terminal transition; `disable` is idempotent, so wrappers
  // already consumed are unaffected by a later abort.
  liveNextCallbacks: NextCallback[]
  // Indirection for adopted-promise reactions: they retain this small gate
  // rather than the whole run state, and the gate is nulled on terminal
  // transition so a promise that never settles cannot keep the run state
  // (or its container) reachable.
  gate: { state: PipeState | null }
  // Removes the abort listener; set only when a signal was supplied.
  abortCleanup?: () => void
  // Optional run-completion observer (`.endAsync`): receives the container
  // snapshot and the active error, if any. Absent for sync `.end()` runs.
  onSettled?: SettlementObserver
}

// Report the run's terminal transition exactly once. Errors finalize
// synchronously — an error dispatched after a completed cascade must win.
// Success is deferred by one job: the cascade may have completed inside a
// flush while a pipe error is still unwinding, and that error takes
// priority over the not-yet-final success.
function settle(state: PipeState, error: Error | null): void {
  // Without a completion observer there is nothing to report — and no
  // settlement job should be scheduled: high-throughput synchronous runs
  // must not accumulate microtask backlog.
  if (!state.onSettled) {
    return
  }
  if (error == null) {
    if (state.settled || state.settling) {
      return
    }
    state.settling = true
    Promise.resolve().then(() => {
      if (state.settled) {
        return
      }
      state.settled = true
      detachAbort(state)
      state.onSettled?.({ container: state.container, error: null, aborted: false })
    })
    return
  }
  // An error overrides a queued success: mark terminal synchronously; the
  // deferred success job observes `settled` and no-ops.
  if (state.settled) {
    return
  }
  // Errors that bypass the dispatch path (continuation exceptions caught
  // in jobs) still mark the run terminal, so sibling in-flight
  // continuations are discarded instead of merging into a failed run.
  if (state.activeError == null) {
    state.activeError = error
  }
  state.settled = true
  detachAbort(state)
  state.onSettled?.({ container: state.container, error, aborted: false })
}

// Remove the abort listener and clear its cleanup — a terminal transition
// (normal or aborted) must not leave the run's state reachable through a
// long-lived shared controller. A signal whose removeEventListener throws
// must not prevent the already-determined outcome from reaching the
// observer, so the cleanup failure is contained here.
function detachAbort(state: PipeState): void {
  const cleanup = state.abortCleanup
  state.abortCleanup = undefined
  if (!cleanup) {
    return
  }
  try {
    cleanup()
  } catch {
    // Contained: the run settles the same way regardless.
  }
}

// Cancellation terminal transition: synchronous, like an error, but it does
// not set `activeError` (abort is not a pipeline failure and must not reach
// `.error(...)`). Marks the run settled, detaches in-flight continuations,
// and reports once. Idempotent — a signal firing after any other terminal
// transition (or a second abort) is a no-op.
function abortRun(state: PipeState, reason?: unknown): void {
  if (state.settled) {
    return
  }
  state.settled = true
  // Detach adopted-promise reactions: a never-settling promise must not keep
  // the run state (or its container) reachable after cancellation.
  state.gate.state = null
  // Void every live `next` wrapper so a retained callback neither advances
  // nor holds run state past the abort. `disable` is idempotent.
  for (const wrapper of state.liveNextCallbacks) {
    wrapper.disable()
  }
  state.liveNextCallbacks.length = 0
  // Remove the abort listener, then capture + clear the observer so it
  // fires exactly once.
  detachAbort(state)
  const observer = state.onSettled
  state.onSettled = undefined
  observer?.({ container: state.container, error: null, aborted: true, reason })
}

// Read the signal's reason defensively — a non-standard signal (or polyfill)
// may not expose one, and a throwing getter must not abort the abort path.
function getAbortReason(signal: AbortSignalLike): unknown {
  try {
    return signal.reason
  } catch {
    return undefined
  }
}

function executePipe(
  pipe: Pipe,
  state: PipeState,
  pipeline: PipelineBase,
  next: AnyFunction,
): void {
  const { fnName } = pipe
  const { container, args } = state
  const { functions } = pipeline

  // Presence-based lookup: a runtime `false` (or other falsey value) must not
  // fall through to the configured dependency.
  const fn = pipe.injected
    ? Object.prototype.hasOwnProperty.call(container, fnName)
      ? container[fnName]
      : functions[fnName]
    : pipe.fn
  // A configured-dependency getter may have aborted the run while resolving
  // `fn` — the pipe must not execute after settlement.
  if (state.settled) {
    return
  }
  // `next` callback state for this pipe invocation, owned locally so a
  // reentrant nested run of the same pipeline cannot clobber it.
  const nextCallbacks: NextCallbacks = {
    wrappers: [],
    holding: false,
    held: [],
    onConsumed: (): void => {
      state.pending -= 1
    },
    onError: (err: Error): boolean => {
      if (!state.onSettled) {
        // No completion observer: surface the programming error on the
        // invoking stack, as before observers existed.
        return false
      }
      // An observed run receives the failure as a rejection; after
      // settlement there is nothing left to report and the duplicate is
      // discarded.
      if (!state.settled) {
        settle(state, err)
      }
      return true
    },
    pipeIndex: state.step - 1,
    isSettled: (): boolean => state.settled,
  }
  const inputArgs = pipe.fetcher.fetch(container, args, functions, nextCallbacks)
  // Each wrapper handed to the pipe is a live continuation until invoked
  // or invalidated: a retained `next` keeps the run open exactly like an
  // adopted promise does.
  state.pending += nextCallbacks.wrappers.length
  // Register the wrappers so an abort can disable them all. Wrappers are
  // not removed on consume — `disable` is idempotent — and the registry is
  // cleared on terminal transition.
  state.liveNextCallbacks.push(...nextCallbacks.wrappers)
  // An input getter may have aborted the run while fetching — discard the
  // wrappers it created rather than letting the pipe run after settlement.
  if (state.settled) {
    invalidateNextCallbacks(nextCallbacks)
    return
  }
  const advance = next as unknown as Continuation

  let result: PipeResult

  // Optional pipe: skip when the dependency or any requested input is
  // unresolved — before the callable is invoked. hasUnresolved also looks
  // inside object-string inputs, whose wrapped object hides missing values
  // from a top-level indexOf.
  if (
    pipe.optional &&
    (fn === undefined || pipe.fetcher.hasUnresolved(container, functions, nextCallbacks.isSettled))
  ) {
    // The skipped pipe never receives its callbacks — consume them so the
    // run is not held open by wrappers that will never fire.
    invalidateNextCallbacks(nextCallbacks)
    advance(state, pipeline)
    return
  } else if (typeof fn === 'function') {
    // `hasUnresolved` above re-reads input accessors; one may have aborted
    // the run while returning a defined value. Do not invoke the pipe after
    // settlement.
    if (state.settled) {
      invalidateNextCallbacks(nextCallbacks)
      return
    }
    // Hold a synchronous `next` call until the pipe's return channel is
    // known, so a pipe that both calls `next` and returns a thenable
    // cannot advance the pipeline before the ambiguity is detected.
    holdNextCallbacks(nextCallbacks)
    try {
      result = fn.apply(0, inputArgs as PipeResult[])
      // The pipe may have aborted the run synchronously and still returned a
      // value (e.g. a thenable); do not inspect or adopt it after settlement.
      if (state.settled) {
        invalidateNextCallbacks(nextCallbacks)
        return
      }
    } catch (err) {
      // Release any held invocation first, preserving the order a
      // synchronous `next` would have advanced in.
      flushNextCallbacks(state, pipeline, advance, nextCallbacks)
      // The duplicate-`next` guard, namespace violations, and continuation
      // ambiguity must surface as themselves, not be routed to the
      // pipeline's error handler — they are programming errors in the
      // pipeline definition, not runtime failures.
      if (
        err instanceof NextCalledTwiceError ||
        err instanceof OutputNameError ||
        err instanceof AmbiguousContinuationError
      ) {
        throw err
      }
      // An exception raised by an error handler (or by the no-handler
      // rethrow) while a pipe's synchronous `next` unwinds is not a fresh
      // pipe error — re-dispatching it would run the handler twice.
      if (state.handlingError) {
        state.handlingError = false
        throw err
      }
      // A falsey thrown value must not be mistaken for successful
      // completion by the error truthiness check downstream.
      advance(state, pipeline, (err || new Error('Pipe threw a falsey value')) as Error)
      return
    }
  } else if (typeof fn === 'boolean') {
    // Raw boolean dependency used for flow control. Any `next` wrapper
    // fetched for this pipe can never fire — the boolean is evaluated
    // directly — so consume it rather than holding the run open.
    invalidateNextCallbacks(nextCallbacks)
    result = fn
  } else {
    // Throw an exception when the dependency is not something we can execute.
    throw new Error(
      `Pipeline [${pipeline.name}] step [${state.step}|${
        pipe.fnName
      }] : Dependency "${fnName}" is not a function or boolean.`,
    )
  }

  // `!` not-pipe: invert a boolean result so `!dep` continues only when
  // the dependency is falsey.
  if (pipe.not && typeof result === 'boolean') {
    result = !result
  }

  // Declarative flow control: a raw boolean dependency or a `!`-pipe uses
  // its boolean to steer the pipeline — `false` halts. Every other return
  // value, boolean included, is ordinary data: a function pipe returning
  // `false` stores it under the output name and the pipeline continues.
  const isFlowControl = pipe.not === true || typeof fn === 'boolean'

  // Read `then` exactly once, guarded: promise assimilation treats an
  // exception while reading (or calling) `then` as a rejection, so such
  // failures reach the error handler instead of escaping synchronously —
  // and a stateful accessor is not probed a second time.
  let thenFn: unknown
  if (result !== null && (typeof result === 'object' || typeof result === 'function')) {
    try {
      thenFn = (result as { then?: unknown }).then
    } catch (err) {
      // The pipe still holds a live `next`: void it so a later call cannot
      // re-run the error handler on the same failure.
      invalidateNextCallbacks(nextCallbacks)
      // An already-rejected branded promise must not lose its rejection
      // observer just because reading its `then` getter failed.
      observeOriginalRejection(result)
      // Native assimilation surfaces an accessor failure as an async
      // rejection — same timing as a throwing `then` method below.
      const failure = (err || new Error('Pipe promise rejected with a falsey value')) as Error
      Promise.reject(failure).catch((reason: Error): void => {
        advance(state, pipeline, reason)
      })
      return
    }
  }
  const thenable = typeof thenFn === 'function'

  // The `then` getter may have aborted the run while returning a callable;
  // do not throw an ambiguity error or adopt the thenable after settlement.
  if (state.settled) {
    invalidateNextCallbacks(nextCallbacks)
    return
  }

  // A pipe that requests `next` owns its own continuation; a thenable
  // return alongside it is ambiguous — which channel advances the
  // pipeline? Fail loudly, invalidate the pipe's callbacks (discarding any
  // held synchronous invocation) so a late `next` cannot fire, and
  // neutralize the returned rejection so it cannot surface later as
  // unhandled.
  if (pipe.fetcher.hasNext && thenable) {
    invalidateNextCallbacks(nextCallbacks)
    Promise.resolve().then(() => {
      // Attempt the intrinsic observer first: it reaches a native promise's
      // original state regardless of overrides and self-reports whether a
      // reaction attached — a branded but slotless receiver falls through
      // to the captured then below.
      observeOriginalRejection(result)
      try {
        // Consume the captured thenable itself. Reflect.apply invokes the
        // callable directly; an own `call` property on the then function
        // cannot affect it. The fulfillment callback assimilates a nested
        // thenable; the rejection callback must not touch its opaque
        // reason.
        Reflect.apply(thenFn as AnyFunction, result, [swallow, ignoreReason])
      } catch {
        // A one-shot `then` that throws here is already consumed.
      }
    })
    throw new AmbiguousContinuationError(
      `Pipeline [${pipeline.name}] step [${state.step}|${pipe.fnName}] : Pipe declares "next" as an input and returned a thenable — use one continuation channel, not both.`,
    )
  }

  // A thenable return from a pipe that did not request `next` is sugar for
  // calling next: resolution continues the pipeline with the value,
  // rejection triggers the error path. Fully synchronous pipelines stay
  // synchronous — the desugar only engages when a thenable appears. The
  // captured `then` is assimilated through a real promise so a throwing
  // `then` call becomes a rejection.
  if (pipe.fetcher.hasNext === false && thenable) {
    // The step this pipe occupies: its settled value merges through this
    // pipe's producer even if the step counter advanced past it (duplicate
    // next callbacks can run later pipes while this promise is in flight).
    const pipeIndex = state.step - 1
    // An adopted promise is a continuation in flight: reaching the end of
    // the pipes is not completion until it settles.
    state.pending += 1
    // The reaction retains only the gate, not the whole run state, so an
    // aborted (or otherwise terminal) run can release its state even while
    // the source promise is still pending.
    const gate = state.gate
    const onFulfilled = (value: PipeResult): void => {
      const current = gate.state
      if (current === null) {
        return
      }
      current.pending -= 1
      // A terminal error already won this execution: a continuation that
      // was pending when the error path was entered resolves too late and
      // is discarded.
      if (current.activeError != null) {
        return
      }
      // Mirrors the synchronous path: `!` inverts a boolean result, and a
      // flow-control pipe halts on `false` — a data pipe continues.
      let resolved = value
      if (pipe.not && typeof resolved === 'boolean') {
        resolved = !resolved
      }
      try {
        if (isFlowControl && resolved === false) {
          // A flow-control halt through a resolved boolean — the
          // synchronous halt branch is never reached on this path. Other
          // continuations may still be in flight; the last one to land
          // merges its output and settles the run.
          current.halted = true
          if (current.pending === 0) {
            settle(current, null)
          }
          return
        }
        advance(current, pipeline, null, resolved, pipeIndex)
      } catch (err) {
        // The continuation threw in a job with no caller stack (for
        // example a namespace violation raised while merging its output):
        // an observer receives it as a rejection; without one, the
        // exception surfaces as an unhandled rejection, as before
        // observers existed.
        if (!current.onSettled) {
          throw err
        }
        settle(current, (err || new Error('Pipe continuation threw a falsey value')) as Error)
      }
    }
    const onRejected = (reason: unknown): void => {
      const current = gate.state
      if (current === null) {
        return
      }
      current.pending -= 1
      if (current.activeError != null) {
        return
      }
      // A falsey rejection reason must not be mistaken for success by
      // the error truthiness check downstream.
      try {
        advance(
          current,
          pipeline,
          (reason || new Error('Pipe promise rejected with a falsey value')) as Error,
          undefined,
          pipeIndex,
        )
      } catch (err) {
        if (!current.onSettled) {
          throw err
        }
        settle(current, (err || new Error('Pipe continuation threw a falsey value')) as Error)
      }
    }

    if (thenFn === Promise.prototype.then) {
      // The intrinsic native then already defers its reactions — invoke it
      // directly so the pipeline continues in ordinary promise ordering
      // without an extra job. Anything else (subclass overrides, proxies)
      // is adopted through the deferred path below, whose real promise
      // settles at most once. The identity comparison cannot trip a proxy
      // trap the way an instanceof brand check can. The callbacks are
      // once-settled: a hostile invocation (e.g. through a proxy's apply
      // trap) that settles and then throws must not also run the error
      // handler.
      let settled = false
      const settleFulfilled = (value: PipeResult): void => {
        if (settled) {
          return
        }
        settled = true
        onFulfilled(value)
      }
      const settleRejected = (reason: unknown): void => {
        if (settled) {
          return
        }
        settled = true
        onRejected(reason)
      }
      try {
        Reflect.apply(thenFn as AnyFunction, result, [settleFulfilled, settleRejected])
      } catch (err) {
        if (!settled) {
          settled = true
          Promise.reject(err).catch(onRejected)
        }
        observeOriginalRejection(result)
      }
      return
    }

    new Promise<PipeResult>((resolve, reject) => {
      // Native assimilation invokes a custom thenable's `then` in a later
      // promise job, after the caller's synchronous initialization
      // completes.
      Promise.resolve().then(() => {
        // A caller may have aborted between the pipe returning and this
        // deferred job running; do not invoke the custom `then` (or start
        // its lazy work) once the run is terminal. A branded native promise
        // still needs its original rejection observed so it is not reported
        // unhandled when it settles later.
        if (gate.state === null) {
          observeOriginalRejection(result)
          return
        }
        try {
          // Reflect.apply invokes the callable directly; an own `call`
          // property on the then function cannot affect adoption. The real
          // resolve/reject pair settles at most once and assimilates
          // whatever the override resolves with, including nested
          // thenables.
          Reflect.apply(thenFn as AnyFunction, result, [resolve, reject])
        } catch (err) {
          reject(err)
        }
        // An override may swallow the rejection — return normally without
        // registering the supplied callbacks — or throw before attaching;
        // either way, observe a branded promise's original rejection
        // regardless of how the override behaved.
        observeOriginalRejection(result)
      })
    }).then(onFulfilled, onRejected)
    return
  }

  // Release any held synchronous `next` invocation now that the return
  // channel is known to be unambiguous.
  flushNextCallbacks(state, pipeline, advance, nextCallbacks)

  // Auto-advance when the pipe does not own its continuation — it did not
  // request `next`, or the dependency is a raw boolean that could never
  // call one — unless a flow-control pipe's boolean is `false` (halt).
  // Duplicate-`next` detection lives on the per-pipe callback handed out
  // by the Fetcher, not here.
  const ownsContinuation = pipe.fetcher.hasNext && typeof fn !== 'boolean'
  if (!ownsContinuation && !(isFlowControl && result === false)) {
    advance(state, pipeline, null, result)
  } else if (!ownsContinuation) {
    // Flow-control halt: progression ended. A guard declining is a normal
    // result, not a failure — resolve with the partial snapshot once no
    // sibling continuation is in flight.
    state.halted = true
    if (state.pending === 0) {
      settle(state, null)
    }
  }
}

/**
 * This function provides a fresh container for each pipeline execution.
 * The `next` method helps executing functions in the pipeline one by one.
 * Save next in the container so pipes could retrieve it as input.
 *
 * @param  {Error|null}     error     Error object if any.
 * @param  {Any}            value     The return value of the previousPipe.
 */
// Continuation entry point. The pipeline continuation itself may be
// invoked from a foreign callback stack (a pipe's retained `next` fired
// from a timer or event emitter) after `runPipeline` has returned; an
// exception raised there (a namespace violation during the merge, a
// throwing error handler) must reach the completion observer as a
// rejection rather than escape uncatchable — and without an observer it
// surfaces on the invoking stack, as it did before observers existed.
function next(
  state: PipeState,
  pipeline: PipelineBase,
  error?: Error,
  value?: PipeResult,
  fromStep?: number,
): void {
  // A terminal state ended the run: a late callback from a timer or event
  // stack (a wrapper that escaped invalidation) is discarded — advancing
  // could mutate a settled run or rethrow from a foreign stack.
  if (state.settled) {
    return
  }
  try {
    continuePipeline(state, pipeline, error, value, fromStep)
  } catch (err) {
    if (state.onSettled) {
      // An observer is watching: an unsettled failure becomes its
      // rejection. After settlement (for example an error handler that
      // throws during dispatch) there is nothing left to report, and
      // rethrowing would escape onto the foreign callback stack that
      // invoked the continuation.
      if (!state.settled) {
        settle(state, (err || new Error('Pipe continuation threw a falsey value')) as Error)
      }
      return
    }
    // An abort (or other terminal transition) may have cleared the observer
    // while this continuation unwound — the run is already settled, so the
    // exception must not escape onto a foreign callback stack.
    if (state.settled) {
      return
    }
    throw err
  }
}

function continuePipeline(
  state: PipeState,
  pipeline: PipelineBase,
  error?: Error,
  value?: PipeResult,
  fromStep?: number,
): void {
  const { pipes, errorHandler } = pipeline
  const { step } = state

  if (value != null) {
    // Merge the output of the pipe the value belongs to — normally the
    // previous step, but an adopted promise settling late names its own
    // pipe: the step counter may have advanced past it.
    const producerIndex = fromStep === undefined ? step - 1 : fromStep
    mergeIntoContainer(
      state,
      pipeline,
      producerIndex,
      pipes[producerIndex].fnName,
      pipes[producerIndex].producer.produce(value, (): boolean => state.settled),
      false,
    )
    // Producing the output may have aborted the run via an accessor; stop
    // before advancing to the next pipe (whose dependency getter would run
    // after cancellation).
    if (state.settled) {
      return
    }
  }

  // The active error is the one passed to `next` — data named `error`
  // merged into the container by a pipe result no longer triggers the
  // error handler.
  if (error != null) {
    state.activeError = error
  }

  if (state.activeError == null) {
    // Clear any stale flag from a previous, fully-handled error path.
    state.handlingError = false
    if (state.halted) {
      // A flow-control halt ended progression: a late sibling continuation
      // merges its own output above, but no further pipes run.
      if (state.pending === 0) {
        settle(state, null)
      }
      return
    }
    if (state.pending > 0) {
      // Continuations from earlier pipes are still in flight: executing
      // the next pipe now would race their outputs. Defer — the last
      // continuation to land advances (or settles) the run with every
      // sibling output merged.
      return
    }
    if (pipes.length > state.step) {
      // When we have more pipe, execute current one and increase the step by 1.
      executePipe(pipes[state.step++], state, pipeline, next)
    } else {
      // Every pipe executed and nothing is in flight — the run completed.
      settle(state, null)
    }
    return
  }

  // Stays set while the handler (or the no-handler rethrow) unwinds, so
  // executePipe's catch does not re-dispatch it as a fresh pipe error.
  state.handlingError = true
  // Report before running the handler: a throwing handler must not strand
  // a completion observer, and a run without a handler reports to the
  // observer instead of throwing — from an async continuation that throw
  // would escape into a microtask and die unhandled.
  settle(state, state.activeError)
  if (errorHandler) {
    ;(errorHandler as ErrorHandler)(state.container, pipeline.functions, state.activeError)
  } else if (!state.onSettled) {
    // Throw the error if we don't have error handling function and no
    // completion observer is watching this run.
    throwNoErrorHandlerError(state.activeError)
  }
}

export function runPipeline(
  args: PipeResult,
  pipeline: PipelineBase,
  onSettled?: SettlementObserver,
  options?: EndAsyncOptions,
): ResultContainer {
  // Internal pipeline execution state.
  const state: PipeState = {
    step: 0,
    // Internale container for keeping pipeline runtime dependencies.
    container: {
      next: (error?: Error, value?: PipeResult, fromStep?: number): void => {
        next(state, pipeline, error, value, fromStep)
      },
    },
    args: Array.isArray(args) ? args : args === undefined ? [] : [args],
    activeError: null,
    handlingError: false,
    settled: false,
    settling: false,
    pending: 0,
    halted: false,
    liveNextCallbacks: [],
    gate: { state: null },
    onSettled,
  }
  state.gate.state = state

  // Register the abort listener before any pipe runs, and short-circuit a
  // signal that aborted before the run started — no input mapping or pipe
  // may execute once the caller has withdrawn the operation. abortRun is
  // idempotent, so a listener already queued by addEventListener on an
  // already-aborted signal is a harmless no-op after the synchronous abort
  // below.
  const signal = options?.signal
  if (signal !== undefined) {
    const onAbort = (): void => abortRun(state, getAbortReason(signal))
    signal.addEventListener('abort', onAbort)
    state.abortCleanup = (): void => signal.removeEventListener('abort', onAbort)
    if (signal.aborted) {
      abortRun(state, getAbortReason(signal))
      return state.container
    }
  }

  try {
    // Start from the input pipes, if any: each maps the invocation arguments
    // into the shared container.
    for (const inputPipe of pipeline.inputPipes || []) {
      mergeIntoContainer(
        state,
        pipeline,
        0,
        inputPipe.fnName,
        inputPipe.producer.produce(state.args, (): boolean => state.settled),
        true,
      )
      // An argument accessor may have aborted the run during mapping; stop
      // before the next declaration triggers more getters.
      if (state.settled) {
        break
      }
    }

    // Start executing pipeline
    next(state, pipeline)
  } catch (err) {
    // A synchronous initialization failure (a reserved-name input, a pipe
    // throwing with no handler and no observer) must not leave the abort
    // listener retaining the run state on a long-lived signal.
    detachAbort(state)
    throw err
  }

  return state.container
}
