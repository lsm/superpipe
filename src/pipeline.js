import { executePipe } from './execution'
import { setWithPipeState } from './set'
import { FN_ERROR, FN_INPUT, createPipe } from './pipe'

export function createAPI(name, defs, deps) {
  const pipeline = createPipeline(name, defs, deps)

  const api = {
    input: function(input) {
      pipeline.pipes.push(createPipe(FN_INPUT, input))
      return api
    },

    pipe: function(fn, input, output) {
      pipeline.pipes.push(createPipe(fn, input, output))
      return api
    },

    // .error('theErrorHandler', ['input1', 'input2'])
    error: function(fn, input) {
      onlyOneErrorHandlerIsAllowed(pipeline.errorHandler)
      pipeline.errorHandler = createPipe(FN_ERROR, fn, input)
      return api
    },

    end: function() {
      return function() {
        execPipeline(arguments, pipeline)
      }
    }
  }

  if (defs) {
    // Automatically end the pipeline if `defs` is provided. So we should
    // chose either the declarative interface or the programmatic one.
    return api.end()
  }

  return api
}

function execPipeline(args, pipeline) {
  const store = createStore(Array.prototype.slice.apply(args), pipeline)
  // Start executing the pipeline.
  store.next()
}

function createPipeline(name, defs, deps) {
  let pipes = []
  let errorHandler
  if (Array.isArray(defs)) {
    defs.forEach(function(pipeDef) {
      let pipe = createPipe(pipeDef[0], pipeDef[1], pipeDef[2])
      if (pipeDef[0] === FN_ERROR) {
        onlyOneErrorHandlerIsAllowed(errorHandler)
        errorHandler = pipe
      } else {
        pipes.push(pipe)
      }
    })
  }
  return { name, pipes, errorHandler, deps: deps || {} }
}

function onlyOneErrorHandlerIsAllowed(errorHandler) {
  if (errorHandler) {
    throw new Error('Each pipeline could only have one error handler.')
  }
}

function createStore(args, pipeline) {
  /**
   * Start from the first pipe of the pipeline.
   * @type {Number}
   */
  let step = 0

  /**
   * Execution state of previous pipe.
   * @type {Object}
   */
  let previousPipeState

  /**
   * We start with a fresh store each time we execute the pipeline.
   * @type {Object}
   */
  const store = {
    /**
     * The function which helps executing functions in the pipeline one by one.
     * Save next to the store so pipes could retrieve it as input.
     *
     * @param  {Object|null}    err   Error object if any.
     * @param  {String|Object}  key   Key of value to store or object of
     *                                key/value maps.
     * @param  {Any}            value Value to store.
     */
    next(err, key, value) {
      if (previousPipeState && previousPipeState.error) {
        // Any subsiquential calls to next should be ignored if error handler is
        // triggered.
        return
      }

      // We have the `key` which means the previous pipe produced
      // some output by calling `next`.  We need to set this output to the store
      // before executing the next pipe.
      if (key) {
        previousPipeState.set(key, value)
      }

      // Save error to the store or get one from it.  This will make sure
      // error will be handled properly no matter how it was set.
      if (err) {
        store.error = err
      } else {
        err = store.error
      }

      // The placeholder for the pipe function which will be executed below.
      let pipe

      if (err) {
        if (!pipeline.errorHandler) {
          // Throw the error if we don't have error handling function.
          throwError(err, step, previousPipeState)
        }
        pipe = pipeline.errorHandler
      } else {
        // Get current pipe and add 1 to the step.
        pipe = pipeline.pipes[step++]
      }

      if (pipe) {
        /**
         * Keep a reference to pipeState for better error handling.
         * @type {Object}
         */
        previousPipeState = createPipeState(err, pipeline, pipe, store)

        // Execute the pipe.
        executePipe(args, store, previousPipeState)
      }
    }
  }

  return store
}

/**
 * Create an object for holding execution state, result and other references
 * of current pipe which allows executing pipeline continously.
 *
 * @param  {Any} error        The error object.
 * @param  {String} name      Name of the pipeline.
 * @param  {Object} pipe      Pipe definition object.
 * @param  {Object} store     The store object which holds all the execution data.
 * @return {Object}           The pipe execution state object.
 */
function createPipeState(error, pipeline, pipe, store) {
  const pipeState = {
    fn: pipe.fn,
    not: pipe.not,
    deps: pipeline.deps,
    input: pipe.input,
    output: pipe.output,
    fnName: pipe.fnName,
    autoNext: true,
    optional: pipe.optional,
    outputMap: pipe.outputMap,
    set(key, value) {
      setWithPipeState(store, pipeState, key, value)
    },
    name: pipeline.name,
    error
  }

  if (pipe.output && pipe.output.length > 0) {
    // Keep track of output fulfilment.
    pipeState.fulfilled = []
    // We will handle the auto next behaviour in setWithPipeState function.
    pipeState.autoNext = pipeState.input.indexOf('set') === -1 ? true : 0
  }

  if (~pipe.input.indexOf('next')) {
    // Auto next is disabled when next is present.
    pipeState.autoNext = false
  }

  return pipeState
}

function throwError(error, step, pipe) {
  let ex = error
  const { name } = pipe
  const pipeName = pipe.fnName || (pipe.fn && pipe.fn.name) || 'function'

  if ('string' === typeof error) {
    ex = new Error()
    ex.name = `\nError was triggered in pipeline "${name}" step "${step}:${pipeName}":\n(Tips: use .pipe("error", errorHandlerFn, ['input']) to handle this error inside your pipeline.)`
    ex.message = `\nError: ${error}`
  }

  throw ex
}
