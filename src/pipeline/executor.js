export function runPipeline (args, pipeline) {
  // Internal pipeline execution state.
  const state = {
    step: 0,
    nextCalled: {},
    previousPipe: null,
    // Internale container for keeping pipeline runtime dependencies.
    container: {
      next: function (error, value) {
        next(state, pipeline, error, value)
      }
    }
  }

  // Start executing from the first pipe.
  const pipe = pipeline.pipes[0]
  // Process input pipe if we have one at the begining of the pipeline.
  if (pipe && pipe.isInputPipe) {
    // The original pipeline arguments is the result of the input pipe
    // which will be merged in next.
    Object.assign(state.container, pipe.producer.produce(args))
    state.step += 1
  }

  // Start executing pipeline
  next(state, pipeline)

  return state.container
}

/**
 * This function provides a fresh container for each pipeline execution.
 * The `next` method helps executing functions in the pipeline one by one.
 * Save next in the container so pipes could retrieve it as input.
 *
 * @param  {Error|null}     error     Error object if any.
 * @param  {Any}            value     The return value of the previousPipe.
 */
export function next (state, pipeline, error, value) {
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
    if (!errorHandler) {
      // Throw the error if we don't have error handling function.
      throwNoErrorHandlerError(error, step - 1, pipeline)
    }
    container.error = error
    errorHandler(container, pipeline.functions)
  } else if (pipes.length > state.step) {
    // When we have more pipe, get current one and increase the step by 1.
    const pipe = pipes[state.step++]
    /**
     * Keep a reference to the previous pipe.
     */
    state.previousPipe = pipe

    // Execute the pipe.
    executePipe(pipe, state, pipeline)
  }
}

export function executePipe (pipe, state, pipeline) {
  const { functions } = pipeline
  const { fnName } = pipe
  const { container } = state

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
    } catch (e) {
      next(state, pipeline, e)
    }
  } else if (pipe.optional && fnType === 'undefined') {
    // Optional pipe, skip the execution.
    state.previousPipe = null
    next(state, pipeline)
  } else {
  // Throw an exception when the function is not something
  // we understand.
    throw new Error(
      `Pipeline [${pipeline.name}] step [${state.step}|${pipe.fnName
      }] : Dependency "${fnName}" is not a function or boolean.`
    )
  }
}

function throwNoErrorHandlerError (error, step, pipeline) {
  const pipe = pipeline.pipes[step]
  const { name } = pipeline
  const { fnName } = pipe

  const ex = new Error()
  ex.name = 'PipelineError'
  ex.message = `\nError was triggered in pipeline "${name}" step "${step}:[${fnName}]":\n(Tips: use .error(errorHandlerFn, 'error') to handle this error within your pipeline.)`
  ex.exception = error

  throw ex
}
