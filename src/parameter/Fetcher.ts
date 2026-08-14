import {
  PipeOutput,
  PipeResult,
  PipeParameter,
  FunctionContainer,
  NextCalledTwiceError,
  RE_IS_OBJ_STRING,
  isValidArrayParameters,
  objectStringToArray,
} from '../common'

// Wrap a `next` callback so it can only be invoked once. The guard is bound
// to the pipe that received the callback, not to a mutable step counter, so
// a stale `next` retained by an earlier pipe cannot advance the pipeline
// around a pipe that is still waiting for its own `next`.
function once (next: Function): Function {
  let called = false
  return function (error?: Error, value?: PipeResult): void {
    if (called) {
      throw new NextCalledTwiceError()
    }
    called = true
    next(error, value)
  }
}

export default class Fetcher {
  // Array of property name to fetch.
  private keys: string[] = []

  private _fetch: Function = this.fetchNothing

  // Set for the fetcher created by `.end(output)`, whose result is returned
  // to the caller rather than spread as invocation arguments.
  private raw: boolean = false

  hasNext: boolean = false

  constructor (parameter: PipeParameter | undefined, flag?: string) {
    if (flag === 'raw') {
      this.raw = true
    }

    if (typeof parameter === 'string') {
      if (RE_IS_OBJ_STRING.test(parameter)) {
        this.keys = objectStringToArray(parameter)
        this._fetch = this.fetchAsObject
      } else if (this.raw) {
        this.keys = [ parameter ]
        this._fetch = this.fetchSingle
      }
      // Normalize string as array.
      // When it's not object string or flag equals raw.
      parameter = [ parameter ]
    }

    if (this._fetch === this.fetchNothing) {
      if (isValidArrayParameters(parameter)) {
        this.keys = parameter as string[]
        this._fetch = this.fetchAsArray
      } else if (parameter == null) {
        this.keys = []
        this._fetch = this.fetchNothing
      } else {
        throw new Error('Pipe input parameter must be non-empty string or array of non-empty strings')
      }
    }

    this.hasNext = this.keys.indexOf('next') > -1
  }

  // `args` are the wrapped invocation arguments, handed to pipes that declare
  // no inputs. `functions` is the configured dependency container, consulted
  // for keys that are not present in `container`.
  fetch (
    container: PipeResult,
    args?: PipeResult[],
    functions?: FunctionContainer
  ): PipeOutput {
    return this._fetch(container, args || [], functions)
  }

  private lookup (
    container: PipeResult,
    functions: FunctionContainer | undefined,
    key: string
  ): PipeResult {
    if (Object.prototype.hasOwnProperty.call(container, key)) {
      return container[key]
    }
    if (functions && Object.prototype.hasOwnProperty.call(functions, key)) {
      return functions[key]
    }
    return undefined
  }

  private value (
    container: PipeResult,
    functions: FunctionContainer | undefined,
    key: string
  ): PipeResult {
    return key === 'next' ? once(container.next) : this.lookup(container, functions, key)
  }

  fetchNothing (_container: PipeResult, args: PipeResult[]): PipeOutput {
    // Pipes without an input declaration receive the original invocation args.
    return args
  }

  fetchSingle (
    container: PipeResult,
    _args: PipeResult[],
    functions?: FunctionContainer
  ): PipeOutput {
    return this.lookup(container, functions, this.keys[0])
  }

  fetchAsArray (
    container: PipeResult,
    _args: PipeResult[],
    functions?: FunctionContainer
  ): PipeOutput {
    return this.keys.map((key: string): PipeResult => this.value(container, functions, key))
  }

  fetchAsObject (
    container: PipeResult,
    _args: PipeResult[],
    functions?: FunctionContainer
  ): PipeOutput {
    const result: PipeResult = {}

    for (const key of this.keys) {
      result[key] = this.value(container, functions, key)
    }

    // The array wrapper suits function invocation; the `.end()` fetcher
    // returns the picked object itself.
    return this.raw ? result : [ result ]
  }
}
