import {
  type AbortSignalLike,
  type AnyFunction,
  type EndAsyncOptions,
  type FunctionContainer,
  type PipeFunction,
  PipelineAbortedError,
  type PipelineBase,
  type PipeOutput,
  type PipeParameter,
  type PipeResult,
} from '../common'
import Fetcher from '../parameter/Fetcher'
import { createErrorPipe, createInputPipe, createPipe } from './builder'
import { runPipeline } from './executor'
import type Pipe from './Pipe'
import type { InputPipe } from './Pipe'

// Read a value's `then` defensively — the output may be a throwing accessor,
// and probing it must not turn a resolved run into a rejection.
function thenOf(value: unknown): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined
  }
  try {
    return (value as { then?: unknown }).then
  } catch {
    return undefined
  }
}

// Read the signal's abort reason defensively (a polyfill may not expose one).
function abortReason(signal: AbortSignalLike): unknown {
  try {
    return signal.reason
  } catch {
    return undefined
  }
}

export default class Pipeline implements PipelineBase {
  name: string

  // Pipes of the pipeline.
  pipes: Pipe[] = []

  // Function container of the pipeline.
  functions: FunctionContainer

  inputPipes: InputPipe[] = []

  errorHandler?: AnyFunction

  constructor(name: string, functions?: FunctionContainer) {
    this.name = name
    // Keep the caller's container by reference so dependency updates made
    // after construction remain visible at execution time.
    this.functions = functions || {}
  }

  input(input?: PipeParameter): Pipeline {
    if (this.pipes.length > 0) {
      throw new Error('Input pipe must be the first pipe in the pipeline.')
    }
    if (input == null || input === '' || (Array.isArray(input) && input.length === 0)) {
      throw new Error('Input pipe requires a non-empty string or array of non-empty strings.')
    }

    // Accumulate: multiple input declarations all populate the store.
    this.inputPipes.push(createInputPipe(input))
    return this
  }

  pipe(fn: PipeFunction, input?: PipeParameter, output?: PipeParameter): Pipeline {
    if (this.errorHandler) {
      throw new Error('Adding new pipe after error pipe is not allowed.')
    }
    // Reserved names: `.pipe('input', [...])` and `.pipe('error', handler, [...])`
    // dispatch to their dedicated builders, as on master.
    if (fn === 'input') {
      return this.input(input)
    }
    if (fn === 'error') {
      return this.error(input as PipeFunction, output)
    }
    const pipe = createPipe(fn, input, output)
    this.pipes.push(pipe)
    return this
  }

  error(fn: PipeFunction, input?: PipeParameter): Pipeline {
    if (this.errorHandler) {
      throw new Error('Each pipeline could only have one error handler.')
    }
    this.errorHandler = createErrorPipe(fn, input)
    return this
  }

  end(output?: PipeParameter): (...args: unknown[]) => PipeOutput {
    const fetcher = new Fetcher(output, 'raw')
    // Make shallow copies of pipeline properties.
    const pipeline: PipelineBase = {
      name: this.name,
      pipes: [...this.pipes],
      inputPipes: [...this.inputPipes],
      functions: this.functions,
      errorHandler: this.errorHandler,
    }

    // NOTE: the executor returns synchronously. When a pipe completes
    // asynchronously — via `next` or a returned Promise — the requested
    // output may not be populated yet; `.end(output)` is only meaningful
    // for synchronous pipelines, async flows should deliver results
    // through a final pipe, callbacks, or an error handler.
    if (output === undefined) {
      // `.end()` without an output spec returns nothing, like master.
      return function (): undefined {
        runPipeline(Array.prototype.slice.apply(arguments), pipeline)
      }
    }

    return function (): PipeOutput {
      const args: PipeResult = Array.prototype.slice.apply(arguments)

      // Start executing the pipeline.
      const container = runPipeline(args, pipeline)
      return fetcher.fetch(container, [], pipeline.functions)
    }
  }

  // Promise-returning counterpart of `.end(output)` for async pipelines:
  // the returned executor settles when the RUN settles — every pipe
  // executed, a flow-control halt fired, or an error was dispatched —
  // not when the synchronous cascade ends. Halted runs resolve with the
  // partial snapshot; errored runs reject with the active error even when
  // an error handler ran (the promise is an additional observer).
  endAsync(
    output?: PipeParameter,
    options?: EndAsyncOptions,
  ): (...args: unknown[]) => Promise<PipeOutput> {
    const fetcher = output === undefined ? null : new Fetcher(output, 'raw')
    const signal = options?.signal
    // Make shallow copies of pipeline properties.
    const pipeline: PipelineBase = {
      name: this.name,
      pipes: [...this.pipes],
      inputPipes: [...this.inputPipes],
      functions: this.functions,
      errorHandler: this.errorHandler,
    }

    return function (): Promise<PipeOutput> {
      const args: PipeResult = Array.prototype.slice.apply(arguments)

      return new Promise<PipeOutput>((resolve, reject) => {
        runPipeline(
          args,
          pipeline,
          (outcome) => {
            // A signal cancellation is distinct from a failure: it rejects
            // with PipelineAbortedError, never the error handler's active
            // error, and it carries the signal's abort reason.
            if (outcome.aborted) {
              reject(new PipelineAbortedError(outcome.reason))
              return
            }
            if (outcome.error != null) {
              reject(outcome.error)
              return
            }
            // With no output spec the run's completion is the result; fetch
            // the requested names from the settled container otherwise. The
            // fetch runs in the settlement job — a throwing dependency
            // accessor here must reject the returned promise, not die as an
            // unhandled rejection while it hangs.
            if (fetcher === null) {
              resolve(undefined as PipeOutput)
              return
            }
            let value: PipeOutput
            try {
              value = fetcher.fetch(outcome.container, [], pipeline.functions) as PipeOutput
            } catch (err) {
              reject(err as Error)
              return
            }
            // If the selected output is itself a thenable, the run has
            // already detached its abort listener; keep cancellation active
            // while the value assimilates by racing it against the signal.
            const then = thenOf(value)
            if (signal !== undefined && typeof then === 'function') {
              let onAbort: (() => void) | undefined
              const aborted = new Promise<never>((_, rejectAbort) => {
                const fire = (): void => rejectAbort(new PipelineAbortedError(abortReason(signal)))
                // A signal already aborted before this adoption will not
                // replay its event to a listener added now — reject now.
                if (signal.aborted) {
                  fire()
                  return
                }
                onAbort = fire
                signal.addEventListener('abort', onAbort)
              })
              // Adopt through the captured `then` (read exactly once, so a
              // stateful getter is not probed twice by Promise.resolve).
              const adopted = new Promise<PipeOutput>((res, rej) => {
                try {
                  Reflect.apply(then as AnyFunction, value, [res, rej])
                } catch (err) {
                  rej(err)
                }
              })
              Promise.race([adopted, aborted]).then(
                (resolved) => {
                  if (onAbort !== undefined) {
                    signal.removeEventListener('abort', onAbort)
                  }
                  resolve(resolved)
                },
                (err) => {
                  if (onAbort !== undefined) {
                    signal.removeEventListener('abort', onAbort)
                  }
                  reject(err as Error)
                },
              )
              return
            }
            resolve(value)
          },
          options,
        )
      })
    }
  }
}
