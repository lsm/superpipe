import { executePipe } from './execution'
import { setWithPipeState } from './set'
import { FN_ERROR, FN_INPUT, createPipe } from './pipe'
import type {
  Pipe,
  Pipeline,
  PipeState,
  Store,
  Dependencies,
  PipelineAPI,
  PipelineDefinition,
  PipeFunctionArg
} from './types'

export function createAPI(
  name: string,
  defs?: PipelineDefinition[],
  deps?: Dependencies
): PipelineAPI | ((...args: unknown[]) => void) {
  const pipeline = createPipeline(name, defs, deps)

  const api: PipelineAPI = {
    input: function(input: string | string[]): PipelineAPI {
      pipeline.pipes.push(createPipe(FN_INPUT, input))
      return api
    },

    pipe: function(
      fn: PipeFunctionArg,
      input?: string | string[],
      output?: string | string[]
    ): PipelineAPI {
      pipeline.pipes.push(createPipe(fn, input, output))
      return api
    },

    // .error('theErrorHandler', ['input1', 'input2'])
    error: function(
      fn: PipeFunctionArg,
      input?: string | string[]
    ): PipelineAPI {
      onlyOneErrorHandlerIsAllowed(pipeline.errorHandler)
      // For error pipes, fn is passed as the second arg (errorFn) and input as the third
      pipeline.errorHandler = createPipe(FN_ERROR, fn as string, input)
      return api
    },

    end: function(): (...args: unknown[]) => void {
      return function(): void {
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

function execPipeline(args: IArguments, pipeline: Pipeline): void {
  const store = createStore(Array.prototype.slice.apply(args), pipeline)
  // Start executing the pipeline.
  store.next()
}

function createPipeline(
  name: string,
  defs?: PipelineDefinition[],
  deps?: Dependencies
): Pipeline {
  const pipes: Pipe[] = []
  let errorHandler: Pipe | undefined
  if (Array.isArray(defs)) {
    defs.forEach(function(pipeDef) {
      const pipe = createPipe(
        pipeDef[0] as ((...args: unknown[]) => unknown) | string,
        pipeDef[1],
        pipeDef[2]
      )
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

function onlyOneErrorHandlerIsAllowed(errorHandler?: Pipe): void {
  if (errorHandler) {
    throw new Error('Each pipeline could only have one error handler.')
  }
}

function createStore(args: unknown[], pipeline: Pipeline): Store {
  /**
   * Start from the first pipe of the pipeline.
   */
  let step = 0

  /**
   * Execution state of previous pipe.
   */
  let previousPipeState: PipeState | undefined

  /**
   * We start with a fresh store each time we execute the pipeline.
   */
  const store: Store = {
    /**
     * The function which helps executing functions in the pipeline one by one.
     * Save next to the store so pipes could retrieve it as input.
     *
     * @param  err - Error object if any.
     * @param  key - Key of value to store or object of key/value maps.
     * @param  value - Value to store.
     */
    next(
      err?: unknown,
      key?: string | Record<string, unknown>,
      value?: unknown
    ): void {
      if (previousPipeState && previousPipeState.error) {
        // Any subsequent calls to next should be ignored if error handler is
        // triggered.
        return
      }

      // We have the `key` which means the previous pipe produced
      // some output by calling `next`. We need to set this output to the store
      // before executing the next pipe.
      if (key && previousPipeState) {
        previousPipeState.set(key, value)
      }

      // Save error to the store or get one from it. This will make sure
      // error will be handled properly no matter how it was set.
      if (err) {
        store.error = err
      } else {
        err = store.error
      }

      // The placeholder for the pipe function which will be executed below.
      let pipe: Pipe | undefined

      if (err) {
        if (!pipeline.errorHandler) {
          // Throw the error if we don't have error handling function.
          // previousPipeState is always defined here since errors are triggered by pipes
          throwError(err, step, previousPipeState!)
        }
        pipe = pipeline.errorHandler
      } else {
        // Get current pipe and add 1 to the step.
        pipe = pipeline.pipes[step++]
      }

      if (pipe) {
        /**
         * Keep a reference to pipeState for better error handling.
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
 * of current pipe which allows executing pipeline continuously.
 *
 * @param  error - The error object.
 * @param  pipeline - The pipeline object.
 * @param  pipe - Pipe definition object.
 * @param  store - The store object which holds all the execution data.
 * @return The pipe execution state object.
 */
function createPipeState(
  error: unknown,
  pipeline: Pipeline,
  pipe: Pipe,
  store: Store
): PipeState {
  const pipeState: PipeState = {
    fn: pipe.fn,
    not: pipe.not,
    deps: pipeline.deps,
    input: pipe.input,
    output: pipe.output,
    fnName: pipe.fnName,
    autoNext: true,
    optional: pipe.optional,
    outputMap: pipe.outputMap,
    set(key: string | Record<string, unknown>, value?: unknown): void {
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

function throwError(
  error: unknown,
  step: number,
  pipe: PipeState
): never {
  let ex: Error
  const { name, fnName } = pipe
  const pipeName = fnName || 'function'

  if ('string' === typeof error) {
    ex = new Error()
    ex.name = `\nError was triggered in pipeline "${name}" step "${step}:${pipeName}":\n(Tips: use .pipe("error", errorHandlerFn, ['input']) to handle this error inside your pipeline.)`
    ex.message = `\nError: ${error}`
  } else {
    ex = error as Error
  }

  throw ex
}
