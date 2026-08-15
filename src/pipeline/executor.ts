import {
  AmbiguousContinuationError,
  type AnyFunction,
  type FunctionContainer,
  NextCalledTwiceError,
  OutputNameError,
  type PipelineBase,
  type PipeOutput,
  type PipeResult,
  throwNoErrorHandlerError,
} from '../common'
import type { NextCallbacks } from '../parameter/Fetcher'
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
      next(state, pipeline, held.error, held.value)
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

// Typed continuation view: AnyFunction's `never[]` parameters maximize
// assignability, but invoking the continuation needs a concrete signature.
type Continuation = (
  state: PipeState,
  pipeline: PipelineBase,
  error?: Error | null,
  value?: PipeResult,
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
function hasConfiguredDependency(functions: FunctionContainer, key: string): boolean {
  for (let obj: unknown = functions; obj != null; obj = Object.getPrototypeOf(obj)) {
    if (obj === Object.prototype) return false
    if (Object.prototype.hasOwnProperty.call(obj, key)) return true
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

// Native-promise brand check, guarded: a Proxy whose getPrototypeOf trap
// throws must answer false rather than escape the caller. A value that
// merely inherits from Promise.prototype still answers true here; the
// observation attempt below self-verifies against such false positives.
function isNativePromiseBrand(value: PipeResult): boolean {
  try {
    return value instanceof Promise
  } catch {
    return false
  }
}

// Attempt to observe a native promise's rejection through the intrinsic
// then, reporting whether a reaction actually attached. The intrinsic
// reaches the promise's original state regardless of any `then` override;
// a branded but slotless receiver, or a species constructor that throws
// when constructed, makes the attach throw before registering anything —
// and no userland mechanism can observe such an object (only the engine's
// internal species-free path, used by `await`, can).
function observeOriginalRejection(value: PipeResult): boolean {
  if (!isNativePromiseBrand(value)) {
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
  for (const key of Object.keys(produced as Record<string, PipeResult>)) {
    if (RESERVED_OUTPUT_NAMES.includes(key)) {
      throw new OutputNameError(
        `Pipeline [${pipeline.name}] step [${step}|${fnName}] : Output name "${key}" is reserved.`,
      )
    }
    if (!isInvocationInput && hasConfiguredDependency(pipeline.functions, key)) {
      throw new OutputNameError(
        `Pipeline [${pipeline.name}] step [${step}|${fnName}] : Output name "${key}" shadows a configured dependency of the same name.`,
      )
    }
  }
  Object.assign(state.container, produced)
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
  // Optional run-completion observer (`.endAsync`): receives the container
  // snapshot and the active error, if any. Absent for sync `.end()` runs.
  onSettled?: (outcome: { container: ResultContainer; error: Error | null }) => void
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
      state.onSettled?.({ container: state.container, error: null })
    })
    return
  }
  // An error overrides a queued success: mark terminal synchronously; the
  // deferred success job observes `settled` and no-ops.
  if (state.settled) {
    return
  }
  state.settled = true
  state.onSettled?.({ container: state.container, error })
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
  // `next` callback state for this pipe invocation, owned locally so a
  // reentrant nested run of the same pipeline cannot clobber it.
  const nextCallbacks: NextCallbacks = { wrappers: [], holding: false, held: [] }
  const inputArgs = pipe.fetcher.fetch(container, args, functions, nextCallbacks)
  const advance = next as unknown as Continuation

  let result: PipeResult

  // Optional pipe: skip when the dependency or any requested input is
  // unresolved — before the callable is invoked. hasUnresolved also looks
  // inside object-string inputs, whose wrapped object hides missing values
  // from a top-level indexOf.
  if (pipe.optional && (fn === undefined || pipe.fetcher.hasUnresolved(container, functions))) {
    advance(state, pipeline)
    return
  } else if (typeof fn === 'function') {
    // Hold a synchronous `next` call until the pipe's return channel is
    // known, so a pipe that both calls `next` and returns a thenable
    // cannot advance the pipeline before the ambiguity is detected.
    holdNextCallbacks(nextCallbacks)
    try {
      result = fn.apply(0, inputArgs as PipeResult[])
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
    // Raw boolean dependency used for flow control.
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
    const onFulfilled = (value: PipeResult): void => {
      // A terminal error already won this execution: a continuation that
      // was pending when the error path was entered resolves too late and
      // is discarded.
      if (state.activeError != null) {
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
          // synchronous halt branch is never reached on this path.
          settle(state, null)
          return
        }
        advance(state, pipeline, null, resolved)
      } catch (err) {
        // The continuation threw in a job with no caller stack (for
        // example a namespace violation raised while merging its output):
        // an observer receives it as a rejection; without one, the
        // exception surfaces as an unhandled rejection, as before
        // observers existed.
        if (!state.onSettled) {
          throw err
        }
        settle(state, (err || new Error('Pipe continuation threw a falsey value')) as Error)
      }
    }
    const onRejected = (reason: unknown): void => {
      if (state.activeError != null) {
        return
      }
      // A falsey rejection reason must not be mistaken for success by
      // the error truthiness check downstream.
      try {
        advance(
          state,
          pipeline,
          (reason || new Error('Pipe promise rejected with a falsey value')) as Error,
        )
      } catch (err) {
        if (!state.onSettled) {
          throw err
        }
        settle(state, (err || new Error('Pipe continuation threw a falsey value')) as Error)
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

  // Auto-advance when the pipe does not request `next`, unless a
  // flow-control pipe's boolean is `false` (halt). Duplicate-`next`
  // detection lives on the per-pipe callback handed out by the Fetcher,
  // not here.
  if (pipe.fetcher.hasNext === false && !(isFlowControl && result === false)) {
    advance(state, pipeline, null, result)
  } else if (pipe.fetcher.hasNext === false) {
    // Flow-control halt: a terminal outcome. Resolve with the partial
    // snapshot — a guard declining is a normal result, not a failure.
    settle(state, null)
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
function next(state: PipeState, pipeline: PipelineBase, error?: Error, value?: PipeResult): void {
  try {
    continuePipeline(state, pipeline, error, value)
  } catch (err) {
    if (state.onSettled && !state.settled) {
      settle(state, (err || new Error('Pipe continuation threw a falsey value')) as Error)
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
): void {
  const { pipes, errorHandler } = pipeline
  const { step } = state

  if (value != null) {
    // Merge the output of previous pipe with container.
    mergeIntoContainer(
      state,
      pipeline,
      step - 1,
      pipes[step - 1].fnName,
      pipes[step - 1].producer.produce(value),
      false,
    )
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
    if (pipes.length > state.step) {
      // When we have more pipe, execute current one and increase the step by 1.
      executePipe(pipes[state.step++], state, pipeline, next)
    } else {
      // Every pipe executed — the run completed.
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
  onSettled?: (outcome: { container: ResultContainer; error: Error | null }) => void,
): ResultContainer {
  // Internal pipeline execution state.
  const state: PipeState = {
    step: 0,
    // Internale container for keeping pipeline runtime dependencies.
    container: {
      next: (error?: Error, value?: PipeResult): void => {
        next(state, pipeline, error, value)
      },
    },
    args: Array.isArray(args) ? args : args === undefined ? [] : [args],
    activeError: null,
    handlingError: false,
    settled: false,
    settling: false,
    onSettled,
  }

  // Start from the input pipes, if any: each maps the invocation arguments
  // into the shared container.
  for (const inputPipe of pipeline.inputPipes || []) {
    mergeIntoContainer(
      state,
      pipeline,
      0,
      inputPipe.fnName,
      inputPipe.producer.produce(state.args),
      true,
    )
  }

  // Start executing pipeline
  next(state, pipeline)

  return state.container
}
