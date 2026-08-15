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
export interface NextCallback {
  (error?: Error, value?: PipeResult): void
  // Void the callback outright — used when the executor rejects an
  // ambiguous continuation, so a late `next` cannot fire afterwards.
  disable: () => void
}

// Per-invocation state shared by the `next` callbacks handed to one pipe:
// the wrappers created by the fetch, and the buffer holding their
// synchronous invocations (in call order) until the pipe's return channel
// is known. Owned by the executor, so reentrant runs of the same pipeline
// never share buffer state.
export interface NextCallbacks {
  wrappers: NextCallback[]
  holding: boolean
  held: { error?: Error; value?: PipeResult }[]
}

// Wrap a `next` callback so it can only be invoked once. The guard is bound
// to the pipe that received the callback, not to a mutable step counter, so
// a stale `next` retained by an earlier pipe cannot advance the pipeline
// around a pipe that is still waiting for its own `next`. While the shared
// buffer is holding, an invocation is queued there instead of advancing.
// A disabled callback discards late invocations silently — the ambiguity
// has already surfaced, and throwing from an unrelated callback stack
// (a timer, an event emitter) would be uncatchable.
function once(next: AnyFunction, callbacks?: NextCallbacks): NextCallback {
  let called = false
  let disabled = false
  const wrapped = ((error?: Error, value?: PipeResult): void => {
    // Invalidation is checked before the duplicate-call guard: a late call
    // on a disabled callback (even a repeat of an earlier held call) must
    // be discarded, never thrown from an unrelated callback stack.
    if (disabled) {
      return
    }
    if (called) {
      throw new NextCalledTwiceError()
    }
    called = true
    if (callbacks?.holding) {
      callbacks.held.push({ error, value })
      return
    }
    next(error, value)
  }) as NextCallback
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
  // `nextCallbacks`, when given, receives the once-wrapped `next` callbacks
  // created by this fetch — an input list may declare `next` more than once,
  // and the executor must be able to buffer or invalidate all of them. It is
  // threaded through the call chain rather than stored on the instance: this
  // fetcher is shared, and a dependency accessor that re-enters the executor
  // mid-fetch would otherwise interfere with the outer invocation's state.
  fetch(
    container: PipeResult,
    args?: PipeResult[],
    functions?: FunctionContainer,
    nextCallbacks?: NextCallbacks,
  ): PipeOutput {
    return this._fetch(container, args || [], functions, nextCallbacks)
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
    nextCallbacks?: NextCallbacks,
  ): PipeResult {
    if (key !== 'next') {
      return this.lookup(container, functions, key)
    }
    const wrapped = once(container.next, nextCallbacks)
    if (nextCallbacks) {
      nextCallbacks.wrappers.push(wrapped)
    }
    return wrapped
  }

  // True when any requested input (except `next`) resolves to undefined.
  hasUnresolved(container: PipeResult, functions?: FunctionContainer): boolean {
    return this.keys.some(
      (key: string): boolean =>
        key !== 'next' && this.lookup(container, functions, key) === undefined,
    )
  }

  fetchNothing(
    _container: PipeResult,
    args: PipeResult[],
    _functions?: FunctionContainer,
    _nextCallbacks?: NextCallbacks,
  ): PipeOutput {
    // Pipes without an input declaration receive the original invocation args.
    return args
  }

  fetchSingle(
    container: PipeResult,
    _args: PipeResult[],
    functions?: FunctionContainer,
    _nextCallbacks?: NextCallbacks,
  ): PipeOutput {
    return this.lookup(container, functions, this.keys[0])
  }

  fetchAsArray(
    container: PipeResult,
    _args: PipeResult[],
    functions?: FunctionContainer,
    nextCallbacks?: NextCallbacks,
  ): PipeOutput {
    return this.keys.map(
      (key: string): PipeResult => this.value(container, functions, key, nextCallbacks),
    )
  }

  fetchAsObject(
    container: PipeResult,
    _args: PipeResult[],
    functions?: FunctionContainer,
    nextCallbacks?: NextCallbacks,
  ): PipeOutput {
    const result: PipeResult = {}

    for (const key of this.keys) {
      result[key] = this.value(container, functions, key, nextCallbacks)
    }

    // The array wrapper suits function invocation; the `.end()` fetcher
    // returns the picked object itself.
    return this.raw ? result : [result]
  }
}
