import Pipe from './Pipe'
import { PipeResult, PipelineBase, throwNoErrorHandlerError } from '../common'

interface ResultContainer {
  [key: string]: PipeResult;
}

interface PipeState {
  step: 0;
  container: ResultContainer;
  nextCalled: {[key: string]: boolean};
}

function executePipe (
  pipe: Pipe, state: PipeState,
  pipeline: PipelineBase, next: Function
): void {
  const { fnName } = pipe
  const { container } = state
  const { functions } = pipeline

  const fn = pipe.injected ? container[fnName] || functions[fnName] : pipe.fn
  const fnType = typeof fn
  const inputArgs = pipe.fetcher.fetch(container)

  let result: PipeResult

  if (fnType === 'function') {
    try {
      result = fn.apply(0, inputArgs)
    } catch (err) {
      return next(state, pipeline, err)
    }
  } else if (fnType === 'boolean') {
    // Raw boolean dependency used for flow control.
    result = fn
  } else if (pipe.optional && fnType === 'undefined') {
    // Optional pipe, skip the execution.
    return next(state, pipeline)
  } else {
    // Throw an exception when the dependency is not something we can execute.
    throw new Error(`Pipeline [${pipeline.name}] step [${state.step}|${pipe.fnName
    }] : Dependency "${fnName}" is not a function or boolean.`)
  }

  // `!` not-pipe: invert a boolean result so `!dep` continues only when
  // the dependency is falsey.
  if (pipe.not && typeof result === 'boolean') {
    result = !result
  }

  // Auto-advance only when the pipe does not request `next` AND does not
  // return `false` (boolean flow control — `false` halts the pipeline).
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
function next (
  state: PipeState, pipeline: PipelineBase,
  error?: Error, value?: PipeResult
): void {
  if (state.nextCalled[state.step]) {
    throw new Error('"next" could not be called more than once in a pipe.')
  }

  state.nextCalled[state.step] = true
  const { pipes, errorHandler } = pipeline
  const { step, container } = state

  if (value != null) {
    // Merge the output of previous pipe with container.
    Object.assign(container, pipes[step - 1].producer.produce(value))
  }

  if (error) {
    if (errorHandler) {
      container.error = error
      errorHandler(container, pipeline.functions)
    } else {
      // Throw the error if we don't have error handling function.
      throwNoErrorHandlerError(error, step - 1, pipeline)
    }
  } else if (pipes.length > state.step) {
    // When we have more pipe, execute current one and increase the step by 1.
    executePipe(pipes[state.step++], state, pipeline, next)
  }
}

export function runPipeline (
  args: PipeResult,
  pipeline: PipelineBase
): ResultContainer {
  // Internal pipeline execution state.
  const state: PipeState = {
    step: 0,
    nextCalled: {},
    // Internale container for keeping pipeline runtime dependencies.
    container: {
      next: function (error?: Error, value?: PipeResult): void {
        next(state, pipeline, error, value)
      },
    },
  }

  // Start executing from input pipe if we have one.
  const inputPipe = pipeline.inputPipe
  if (inputPipe) {
    // Produce output from the original pipeline arguments
    // which will be merged with state container.
    Object.assign(state.container, inputPipe.producer.produce(args))
  }

  // Start executing pipeline
  next(state, pipeline)

  return state.container
}
