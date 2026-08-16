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
  RE_IS_OBJ_STRING,
} from '../common'
import Fetcher from '../parameter/Fetcher'
import { createErrorPipe, createInputPipe, createPipe } from './builder'
import { observeOriginalRejection, runPipeline } from './executor'
import type Pipe from './Pipe'
import type { InputPipe } from './Pipe'

// Read a value's `then` exactly once. A throwing accessor propagates to the
// caller — swallowing it here would make the returned promise resolve with
// the object instead of rejecting with the accessor's error, and probing a
// second time (through native assimilation) would re-run its side effects.
function thenOf(value: unknown): unknown {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
    return undefined
  }
  return (value as { then?: unknown }).then
}

// Read the signal's abort reason defensively (a polyfill may not expose one).
function abortReason(signal: AbortSignalLike): unknown {
  try {
    return signal.reason
  } catch {
    return undefined
  }
}

// Observe the values abandoned by a cancelled output selection. A multi-key
// spec fetches an internally built array (or plain object, for object-string
// syntax); only its entries can be rejected native promises, so each is
// observed individually — reading the wrapper itself runs no user code. A
// single-key spec fetches the raw value, whose own properties may be hostile
// accessors, so it is observed as a whole and never probed key by key.
// Internally built arrays are walked by index: the iterable protocol stays
// uninvoked after cancellation, since an aborting accessor may have replaced
// Array.prototype[Symbol.iterator].
function observeAbandonedSelection(value: PipeOutput, wrapped: boolean): void {
  if (!wrapped) {
    observeOriginalRejection(value)
    return
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      observeOriginalRejection(value[i])
    }
    return
  }
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value)
    for (let i = 0; i < keys.length; i += 1) {
      observeOriginalRejection((value as Record<string, PipeResult>)[keys[i]])
    }
    return
  }
  observeOriginalRejection(value)
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
    // A multi-key output spec fetches an internally built wrapper (array, or
    // plain object for object-string syntax); a single name fetches the raw
    // value. The distinction governs how an abandoned selection is observed.
    const wrapped =
      output !== undefined &&
      (Array.isArray(output) || (typeof output === 'string' && RE_IS_OBJ_STRING.test(output)))
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
            // result must still reject rather than resolve. The abandoned
            // selection may contain rejected branded promises the run will
            // never adopt — observe each so it is not reported unhandled.
            if (signal?.aborted) {
              observeAbandonedSelection(value, wrapped)
              reject(new PipelineAbortedError(abortReason(signal)))
              return
            }
            // Read the selected output's `then` exactly once. A throwing
            // getter rejects the returned promise with its error — like the
            // native assimilation this path replaced — while a branded native
            // promise's original rejection still gets an observer, and an
            // abort raised during the read wins over the getter error.
            let then: unknown
            try {
              then = thenOf(value)
            } catch (err) {
              observeOriginalRejection(value as PipeResult)
              if (signal?.aborted) {
                reject(new PipelineAbortedError(abortReason(signal)))
              } else {
                reject((err || new Error('Output accessor threw a falsey value')) as Error)
              }
              return
            }
            // `thenOf` may have aborted the run via a throwing/aborting getter;
            // recheck before adopting whatever it returned. An already-rejected
            // branded promise is never adopted on this path — observe its
            // original rejection so it is not reported unhandled.
            if (signal?.aborted) {
              observeAbandonedSelection(value, wrapped)
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
                    // A signal whose removeEventListener throws must not
                    // prevent the already-determined result from settling
                    // the adoption — `settled` is already true, so a later
                    // finish callback could not recover it.
                    try {
                      signal.removeEventListener('abort', onAbort)
                    } catch {
                      // Contained: settle regardless.
                    }
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
                  // An intervening microtask may have aborted the run after the
                  // gate was installed; the adoption already rejected, so the
                  // thenable's lazy work must not start. A branded native
                  // promise still needs its original rejection observed.
                  if (settled) {
                    observeOriginalRejection(value as PipeResult)
                    return
                  }
                  try {
                    Reflect.apply(then as AnyFunction, value, [finishResolve, finishReject])
                  } catch (err) {
                    finishReject(err)
                  }
                  // An override may swallow the callbacks — return normally
                  // without registering them — and a later abort then wins the
                  // adoption; observe a branded promise's original rejection
                  // regardless of how the override behaved.
                  observeOriginalRejection(value as PipeResult)
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
