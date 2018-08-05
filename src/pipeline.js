import { FN_ERROR, FN_INPUT, createPipe } from './pipe'
import { executePipe, setWithPipeState } from './execution'

export function createPipeline(name, defs, deps) {
  var { pipes, errorHandler } = createPipes(defs)

  var pipeline = {
    input: function(input) {
      pipes.push(createPipe(FN_INPUT, input))
      return pipeline
    },

    pipe: function(fn, input, output) {
      pipes.push(createPipe(fn, input, output))
      return pipeline
    },

    // .error('theErrorHandler', ['input1', 'input2'])
    error: function(fn, input) {
      onlyOneErrorHandlerIsAllowed(errorHandler)
      errorHandler = createPipe(FN_ERROR, fn, input)
      return pipeline
    },

    end: function() {
      return function() {
        /**
         * Convert original function arguments to array.
         *
         * @type {Array}
         */
        var args = Array.prototype.slice.call(arguments)

        execPipeline(name, pipeline, pipes, args, deps || {}, errorHandler)
      }
    }
  }

  if (defs) {
    // Automatically end the pipeline if `defs` is provided. So we should
    // chose either the declarative interface or the programmatic one.
    return pipeline.end()
  }

  return pipeline
}

function createPipes(defs) {
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
  return { pipes, errorHandler }
}

function onlyOneErrorHandlerIsAllowed(errorHandler) {
  if (errorHandler) {
    throw new Error('Each pipeline could only have one error handler.')
  }
}

/**
 * The function which triggers the execution of the pipeline.
 */
function execPipeline(name, pipeline, pipes, args, dep, errorHandler) {
  /**
   * Start from the first pipe of the pipeline.
   * @type {Number}
   */
  var step = 0

  /**
   * We start with a fresh store rach time we execute the pipeline.
   * @type {Object}
   */
  var store = {
    set: function(key, value) {
      store[key] = value
    }
  }

  /**
   * Error has triggered or not.
   * @type {Boolean}
   */
  let errorTriggered = false

  /**
   * Execution state of previous pipe.
   * @type {Object}
   */
  var previousPipeState

  /**
   * The function which helps executing functions in the pipeline one by one.
   *
   * @param  {Object|null}    err   Error object if any.
   * @param  {String|Object}  key   Key of value to store or object of
   *                                key/value maps.
   * @param  {Any}            value Value to store.
   */
  var next = function next(err, key, value) {
    if (previousPipeState && arguments.length > 1) {
    if (errorTriggered) {
      // Any subsiquential calls to next should be ignored if error handler is
      // triggered.
      return
    }

      // `next` could be called before the return of previous pipe so we need
      // to set the `autoNext` flag of previous pipe state to false to avoid
      // `double next`.
      previousPipeState.autoNext = false

      // We have more than one argument which means the previous pipe produced
      // some output by calling `next`.  We need to merge this output with the
      // store before executing the next pipe.
      // set(store, key, value)
      setWithPipeState(store, previousPipeState, key, value)
    }

    // Save error to the store or get one from it.  This will make sure
    // error will be handled properly no matter how it was set.
    if (err) {
      store.error = err
    } else {
      err = store.error
    }

    // The placeholder for the pipe function which will be executed below.
    var pipe

    if (err) {
      pipe = errorHandler
      if (!pipe) {
        // Throw the error if we don't have error handling function.
        throwError(err, name, step, previousPipeState)
      }
    } else {
      // Get current pipe and add 1 to the step.
      pipe = pipes[step++]
    }

    if (pipe) {
      /**
       * Object for holding execution state, result and other references
       * of current pipe for executing pipeline continously.
       *
       * @type {Object}
       */
      var pipeState = {
        fn: pipe.fn,
        not: pipe.not,
        input: pipe.input,
        output: pipe.output,
        fnName: pipe.fnName,
        autoNext: pipe.autoNext,
        optional: pipe.optional,
        outputMap: pipe.outputMap,
        next: next,
        result: undefined,
        fnReturned: false
      }

      /**
       * Keep a reference to pipeState for better error handling.
       * @type {Object}
       */
      previousPipeState = pipeState

      if (err) {
        errorTriggered = true
      }

      // Excute the pipe.
      executePipe(err, args, dep, store, pipeState)
    }
  }

  // Save next to the store so pipes could retrieve it as input.
  store.next = next

  // Start executing the pipeline.
  next()
}

/**
 * Pipeline instance functions
 */

function throwError(error, name, step, pipe) {
  var ex = error

  var pipeName = (pipe && pipe.fnName) || pipe.fn.name || 'function'

  if ('string' === typeof error) {
    ex = new Error()
    ex.name = `\nError was triggered in pipeline "${name}" step "${step}:${pipeName}":\n(Tips: use .pipe("error", errorHandlerFn, ['input']) to handle this error inside your pipeline.)`
    ex.message = `\nError: ${error}`
  }

  throw ex
}
