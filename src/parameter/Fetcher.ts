import {
  type AnyFunction,
  type FunctionContainer,
  isValidArrayParameters,
  NextCalledTwiceError,
  objectStringToArray,
  type PipeOutput,
  type PipeParameter,
  type PipeResult,
  RE_IS_OBJ_STRING,
} from '../common'

// A once-wrapped `next` callback handed to a pipe.
export interface NextWrapper extends AnyFunction {
  // Hold a synchronous invocation in a buffer instead of advancing — the
  // executor flushes it once the pipe's return channel is known.
  beginBuffering: () => void
  // Release a held invocation (unless the wrapper was disabled).
  endBuffering: () => void
  // Void the callback and discard any buffered invocation.
  disable: () => void
}

// Wrap a `next` callback so it can only be invoked once. The guard is bound
// to the pipe that received the callback, not to a mutable step counter, so
// a stale `next` retained by an earlier pipe cannot advance the pipeline
// around a pipe that is still waiting for its own `next`.
function once(next: AnyFunction): NextWrapper {
  let called = false
  let disabled = false
  let buffering = false
  let buffered: { error?: Error; value?: PipeResult } | null = null
  const wrapped = ((error?: Error, value?: PipeResult): void => {
    if (called) {
      throw new NextCalledTwiceError()
    }
    if (disabled) {
      throw new Error(
        '"next" is disabled: the pipe declared "next" as an input and also returned a thenable.',
      )
    }
    called = true
    if (buffering) {
      buffered = { error, value }
      return
    }
    next(error, value)
  }) as NextWrapper
  wrapped.beginBuffering = (): void => {
    buffering = true
  }
  wrapped.endBuffering = (): void => {
    buffering = false
    if (buffered && !disabled) {
      const held = buffered
      buffered = null
      next(held.error, held.value)
    }
  }
  wrapped.disable = (): void => {
    disabled = true
  }
  return wrapped
}

export default class Fetcher {
  // Array of property name to fetch.
  private keys: string[] = []

  private _fetch: AnyFunction = this.fetchNothing

  // Set for the fetcher created by `.end(output)`, whose result is returned
  // to the caller rather than spread as invocation arguments.
  private raw: boolean = false

  hasNext: boolean = false

  // Collects the once-wrapped `next` callbacks created by the fetch in
  // progress. The caller owns the array, keeping callback state
  // invocation-local — this fetcher is shared across runs, so storing the
  // wrappers here would let a reentrant nested run clobber the outer
  // invocation's callbacks.
  private nextCollector: NextWrapper[] | null = null

  constructor(parameter: PipeParameter | undefined, flag?: string) {
    if (flag === 'raw') {
      this.raw = true
    }

    if (typeof parameter === 'string') {
      if (RE_IS_OBJ_STRING.test(parameter)) {
        this.keys = objectStringToArray(parameter)
        this._fetch = this.fetchAsObject
      } else if (this.raw) {
        this.keys = [parameter]
        this._fetch = this.fetchSingle
      }
      // Normalize string as array.
      // When it's not object string or flag equals raw.
      parameter = [parameter]
    }

    if (this._fetch === this.fetchNothing) {
      if (isValidArrayParameters(parameter)) {
        this.keys = parameter as string[]
        this._fetch = this.fetchAsArray
      } else if (parameter == null) {
        this.keys = []
        this._fetch = this.fetchNothing
      } else {
        throw new Error(
          'Pipe input parameter must be non-empty string or array of non-empty strings',
        )
      }
    }

    this.hasNext = this.keys.indexOf('next') > -1
  }

  // `args` are the wrapped invocation arguments, handed to pipes that declare
  // no inputs. `functions` is the configured dependency container, consulted
  // for keys that are not present in `container`.
  // `nextCallbacks`, when given, collects the once-wrapped `next` callbacks
  // created by this fetch — an input list may declare `next` more than once,
  // and the executor must be able to buffer or invalidate all of them.
  fetch(
    container: PipeResult,
    args?: PipeResult[],
    functions?: FunctionContainer,
    nextCallbacks?: NextWrapper[],
  ): PipeOutput {
    this.nextCollector = nextCallbacks || []
    const output = this._fetch(container, args || [], functions)
    this.nextCollector = null
    return output
  }

  private lookup(
    container: PipeResult,
    functions: FunctionContainer | undefined,
    key: string,
  ): PipeResult {
    if (Object.prototype.hasOwnProperty.call(container, key)) {
      return container[key]
    }
    if (functions && Object.prototype.hasOwnProperty.call(functions, key)) {
      return functions[key]
    }
    return undefined
  }

  private value(
    container: PipeResult,
    functions: FunctionContainer | undefined,
    key: string,
  ): PipeResult {
    if (key !== 'next') {
      return this.lookup(container, functions, key)
    }
    const wrapped = once(container.next)
    this.nextCollector?.push(wrapped)
    return wrapped
  }

  // True when any requested input (except `next`) resolves to undefined.
  hasUnresolved(container: PipeResult, functions?: FunctionContainer): boolean {
    return this.keys.some(
      (key: string): boolean =>
        key !== 'next' && this.lookup(container, functions, key) === undefined,
    )
  }

  fetchNothing(_container: PipeResult, args: PipeResult[]): PipeOutput {
    // Pipes without an input declaration receive the original invocation args.
    return args
  }

  fetchSingle(
    container: PipeResult,
    _args: PipeResult[],
    functions?: FunctionContainer,
  ): PipeOutput {
    return this.lookup(container, functions, this.keys[0])
  }

  fetchAsArray(
    container: PipeResult,
    _args: PipeResult[],
    functions?: FunctionContainer,
  ): PipeOutput {
    return this.keys.map((key: string): PipeResult => this.value(container, functions, key))
  }

  fetchAsObject(
    container: PipeResult,
    _args: PipeResult[],
    functions?: FunctionContainer,
  ): PipeOutput {
    const result: PipeResult = {}

    for (const key of this.keys) {
      result[key] = this.value(container, functions, key)
    }

    // The array wrapper suits function invocation; the `.end()` fetcher
    // returns the picked object itself.
    return this.raw ? result : [result]
  }
}
