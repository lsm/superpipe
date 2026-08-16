import {
  type AnyFunction,
  type EndAsyncOptions,
  type FunctionContainer,
  type PipeFunction,
  PipelineAbortedError,
  type PipelineBase,
  type PipeOutput,
  type PipeParameter,
  type PipeResult,
  signalAborted,
  signalReason,
} from '../common'
import Fetcher from '../parameter/Fetcher'
import { createErrorPipe, createInputPipe, createPipe } from './builder'
import { runPipeline } from './executor'
import type Pipe from './Pipe'
import type { InputPipe } from './Pipe'

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
  //
  // `options.signal` opts into AbortSignal cancellation: when the signal
  // aborts, the returned promise rejects with `PipelineAbortedError` (never
  // routed through the error handler) and the abort listener is detached.
  // Cancellation is racing at the promise boundary — the underlying run is
  // not interrupted, only abandoned; its late settle is discarded. A signal
  // already aborted at call time rejects before the first pipe runs.
  //
  // "Completed" means the returned promise has settled: because a successful
  // run defers its settlement by one job (so an in-flight error wins), an
  // abort fired synchronously right after `run()` returns — before any
  // `await` — still cancels a run whose pipes all finished in that tick.
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

    // Run the pipeline and settle with its outcome. Synchronous pipe code and
    // dependency getters run inside the promise executor, so a synchronous
    // throw (a reserved-name input, an ambiguous continuation) rejects the
    // returned promise rather than escaping the caller.
    const runPipelinePromise = (args: PipeResult): Promise<PipeOutput> =>
      new Promise<PipeOutput>((resolve, reject) => {
        runPipeline(args, pipeline, (outcome) => {
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
          try {
            resolve(fetcher.fetch(outcome.container, [], pipeline.functions) as PipeOutput)
          } catch (err) {
            reject(err as Error)
          }
        })
      })

    return function (): Promise<PipeOutput> {
      const args: PipeResult = Array.prototype.slice.apply(arguments)

      // No signal (or a `null`/missing one): the run's own settlement is the
      // result.
      if (signal == null) {
        return runPipelinePromise(args)
      }

      // Register the abort listener BEFORE the run starts. `runPipeline` runs
      // synchronous pipe code (and dependency getters) inside the promise
      // executor, so an abort fired synchronously during that initial cascade
      // — a self-cancelling pipe, a throwing accessor — is dispatched to the
      // listener synchronously and not missed (the `abort` event is one-shot:
      // a listener attached after dispatch never fires). The listener is
      // detached on either terminal transition, so a long-lived shared
      // controller never retains a completed run.
      let onAbort: (() => void) | undefined
      let listenerAttached = false
      const aborted = new Promise<PipeOutput>((_, reject) => {
        onAbort = (): void => {
          reject(new PipelineAbortedError(signalReason(signal)))
        }
        try {
          signal.addEventListener('abort', onAbort)
          listenerAttached = true
        } catch (err) {
          // A non-conforming signal whose addEventListener throws rejects the
          // run rather than escaping the caller synchronously.
          reject(err)
        }
      })

      const cleanup = (): void => {
        if (!listenerAttached || onAbort === undefined) {
          return
        }
        try {
          signal.removeEventListener('abort', onAbort)
        } catch {
          // A throwing removeEventListener must not break settlement.
        }
      }

      // A non-conforming signal that could not register its listener, or one
      // already aborted at call time, rejects before the first pipe runs.
      // Register-then-check: an abort fired between `runPipelinePromise` and
      // this check is already observed by the listener above; this covers an
      // abort that predates the listener (missed by `addEventListener` alone).
      if (!listenerAttached || signalAborted(signal)) {
        onAbort?.()
        return aborted.finally(cleanup)
      }

      // `Promise.race` settles with whichever comes first; `finally` detaches
      // the listener either way. The losing promise's settlement is simply
      // discarded — `race` never rethrows an unhandled rejection from the
      // side that lost.
      return Promise.race([runPipelinePromise(args), aborted]).finally(cleanup)
    }
  }
}
