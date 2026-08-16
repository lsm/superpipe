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
              value = fetcher.fetch(outcome.container, [], pipeline.functions, {
                wrappers: [],
                holding: false,
                held: [],
                isSettled: (): boolean => signal?.aborted ?? false,
              }) as PipeOutput
            } catch (err) {
              // An output accessor may have aborted before throwing — the
              // cancellation precedes the accessor error and must win.
              if (signal?.aborted) {
                reject(new PipelineAbortedError(abortReason(signal)))
              } else {
                reject(err as Error)
              }
              return
            }
            // An output accessor may have aborted the signal while being
            // fetched (the run's listener is already detached); a non-thenable
            // result must still reject rather than resolve.
            if (signal?.aborted) {
              reject(new PipelineAbortedError(abortReason(signal)))
              return
            }
            // Read the selected output's `then` exactly once.
            const then = thenOf(value)
            // `thenOf` may have aborted the run via a throwing/aborting getter;
            // recheck before adopting whatever it returned.
            if (signal?.aborted) {
              reject(new PipelineAbortedError(abortReason(signal)))
              return
            }
            if (typeof then === 'function') {
              // Adopt the thenable through the captured `then` (never
              // re-read), gating settlement so the first of (abort, resolve,
              // reject) wins in the order the events actually occur.
              const adopted = new Promise<PipeOutput>((res, rej) => {
                let settled = false
                let onAbort: (() => void) | undefined
                const detach = (): void => {
                  if (onAbort !== undefined && signal !== undefined) {
                    signal.removeEventListener('abort', onAbort)
                  }
                }
                const finishResolve = (v: PipeOutput): void => {
                  if (settled) {
                    return
                  }
                  settled = true
                  detach()
                  res(v)
                }
                const finishReject = (err: unknown): void => {
                  if (settled) {
                    return
                  }
                  settled = true
                  detach()
                  rej(err)
                }
                if (signal !== undefined) {
                  const fire = (): void =>
                    finishReject(new PipelineAbortedError(abortReason(signal)))
                  if (signal.aborted) {
                    fire()
                    return
                  }
                  onAbort = fire
                  signal.addEventListener('abort', onAbort)
                }
                // Defer the custom `then` invocation to a promise job (matching
                // native assimilation ordering) after the abort gate is installed.
                Promise.resolve().then(() => {
                  try {
                    Reflect.apply(then as AnyFunction, value, [finishResolve, finishReject])
                  } catch (err) {
                    finishReject(err)
                  }
                })
              })
              resolve(adopted)
              return
            }
            resolve(value)
          },
          signal === undefined ? undefined : { signal },
        )
      })
    }
  }
}
