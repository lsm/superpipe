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
  next: AnyFunction,
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
  for (const key of Object.keys(produced)) {
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
  // True while an error handler (or the no-handler throw) is unwinding —
  // such exceptions must not be treated as fresh pipe errors.
  handlingError: boolean
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

  let result: PipeResult

  // Optional pipe: skip when the dependency or any requested input is
  // unresolved — before the callable is invoked. hasUnresolved also looks
  // inside object-string inputs, whose wrapped object hides missing values
  // from a top-level indexOf.
  if (pipe.optional && (fn === undefined || pipe.fetcher.hasUnresolved(container, functions))) {
    return next(state, pipeline)
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
      flushNextCallbacks(state, pipeline, next, nextCallbacks)
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
      return next(state, pipeline, (err || new Error('Pipe threw a falsey value')) as Error)
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
      // Native assimilation surfaces an accessor failure as an async
      // rejection — same timing as a throwing `then` method below.
      const failure = (err || new Error('Pipe promise rejected with a falsey value')) as Error
      Promise.reject(failure).catch((reason: Error): void => {
        next(state, pipeline, reason)
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
    // The cleanup callbacks must assimilate whatever the thenable resolves
    // with — a nested rejected promise resolved here would otherwise die as
    // an unhandled rejection.
    const swallow = (value: unknown): void => {
      Promise.resolve(value).then(
        () => {},
        () => {},
      )
    }
    Promise.resolve().then(() => {
      try {
        // Reflect.apply invokes the callable directly; an own `call`
        // property on the then function cannot affect adoption.
        Reflect.apply(thenFn as AnyFunction, result, [swallow, swallow])
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
      // Mirrors the synchronous path: `!` inverts a boolean result, and
      // `false` halts the pipeline.
      let resolved = value
      if (pipe.not && typeof resolved === 'boolean') {
        resolved = !resolved
      }
      if (resolved !== false) {
        next(state, pipeline, null, resolved)
      }
    }
    const onRejected = (reason: unknown): void => {
      // A falsey rejection reason must not be mistaken for success by
      // the error truthiness check downstream.
      next(
        state,
        pipeline,
        (reason || new Error('Pipe promise rejected with a falsey value')) as Error,
      )
    }

    if (result instanceof Promise) {
      // A native promise already defers its reactions — invoke the captured
      // `then` directly so the pipeline continues in ordinary promise
      // ordering without an extra job. The captured callable is used (not
      // re-read) and guarded: a subclass `then` override that throws is
      // routed to the error path, not out of run().
      try {
        Reflect.apply(thenFn as AnyFunction, result, [onFulfilled, onRejected])
      } catch (err) {
        Promise.reject(err).catch(onRejected)
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
          // property on the then function cannot affect adoption.
          Reflect.apply(thenFn as AnyFunction, result, [resolve, reject])
        } catch (err) {
          reject(err)
        }
      })
    }).then(onFulfilled, onRejected)
    return
  }

  // Release any held synchronous `next` invocation now that the return
  // channel is known to be unambiguous.
  flushNextCallbacks(state, pipeline, next, nextCallbacks)

  // Auto-advance only when the pipe does not request `next` AND does not
  // return `false` (boolean flow control — `false` halts the pipeline).
  // Duplicate-`next` detection lives on the per-pipe callback handed out by
  // the Fetcher, not here.
  if (pipe.fetcher.hasNext === false && result !== false) {
    next(state, pipeline, null, result)
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
function next(state: PipeState, pipeline: PipelineBase, error?: Error, value?: PipeResult): void {
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
    }
    return
  }

  // Stays set while the handler (or the no-handler rethrow) unwinds, so
  // executePipe's catch does not re-dispatch it as a fresh pipe error.
  state.handlingError = true
  if (errorHandler) {
    errorHandler(state.container, pipeline.functions, state.activeError)
  } else {
    // Throw the error if we don't have error handling function.
    throwNoErrorHandlerError(state.activeError)
  }
}

export function runPipeline(args: PipeResult, pipeline: PipelineBase): ResultContainer {
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
