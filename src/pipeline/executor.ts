import {
  type AnyFunction,
  NextCalledTwiceError,
  type PipelineBase,
  type PipeResult,
  throwNoErrorHandlerError,
} from '../common'
import type Pipe from './Pipe'

interface ResultContainer {
  [key: string]: PipeResult
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
  const inputArgs = pipe.fetcher.fetch(container, args, functions)

  let result: PipeResult

  // Optional pipe: skip when the dependency or any requested input is
  // unresolved — before the callable is invoked. hasUnresolved also looks
  // inside object-string inputs, whose wrapped object hides missing values
  // from a top-level indexOf.
  if (pipe.optional && (fn === undefined || pipe.fetcher.hasUnresolved(container, functions))) {
    return next(state, pipeline)
  } else if (typeof fn === 'function') {
    try {
      result = fn.apply(0, inputArgs as PipeResult[])
    } catch (err) {
      // The duplicate-`next` guard must surface as itself, not be wrapped.
      if (err instanceof NextCalledTwiceError) {
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
    Object.assign(state.container, pipes[step - 1].producer.produce(value))
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
    Object.assign(state.container, inputPipe.producer.produce(state.args))
  }

  // Start executing pipeline
  next(state, pipeline)

  return state.container
}
