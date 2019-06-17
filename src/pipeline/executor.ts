import Pipe from './Pipe'
import { PipeResult, PipelineBase, throwNoErrorHandlerError } from '../common'

interface ResultContainer {
  [key: string]: PipeResult;
}

interface PipeState {
  step: 0;
  container: ResultContainer;
  nextCalled: {[key: string]: boolean};
  previousPipe?: Pipe;
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

  if (fnType === 'function') {
    try {
      const result = fn.apply(0, inputArgs)
      if (!pipe.fetcher.hasNext) {
        // Run next pipe automatically when next is not required by the input.
        next(state, pipeline, null, result)
      }
    } catch (err) {
      next(state, pipeline, err)
    }
  } else if (pipe.optional && fnType === 'undefined') {
    // Optional pipe, skip the execution.
    state.previousPipe = undefined
    next(state, pipeline)
  } else {
  // Throw an exception when the function is not something
  // we understand.
    throw new Error(`Pipeline [${pipeline.name}] step [${state.step}|${pipe.fnName
    }] : Dependency "${fnName}" is not a function or boolean.`)
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
  const { step, container, previousPipe } = state

  if (previousPipe && value != null) {
    // Merge the output with container.
    Object.assign(container, previousPipe.producer.produce(value))
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
    // When we have more pipe, get current one and increase the step by 1.
    const pipe = pipes[state.step++]

    /**
     * Keep a reference to the previous pipe.
     */
    state.previousPipe = pipe

    // Execute the pipe.
    executePipe(pipe, state, pipeline, next)
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
      next: function (error: Error, value: PipeResult): void {
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
