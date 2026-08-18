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


export interface NextCallback {
  (error?: Error, value?: PipeResult): void
  
  
  disable: () => void
}







export interface NextCallbacks {
  wrappers: NextCallback[]
  holding: boolean
  held: { error?: Error; value?: PipeResult }[]
  onConsumed?: () => void
  
  
  
  onError?: (err: Error) => boolean
  
  
  
  pipeIndex?: number
}









function once(next: AnyFunction, callbacks?: NextCallbacks): NextCallback {
  let called = false
  let disabled = false
  
  
  let counted = true
  const consume = (): void => {
    if (counted) {
      counted = false
      callbacks?.onConsumed?.()
    }
  }
  
  
  
  let advance: ((error?: Error, value?: PipeResult, fromStep?: number) => void) | null = next as (
    error?: Error,
    value?: PipeResult,
    fromStep?: number,
  ) => void
  const wrapped = ((error?: Error, value?: PipeResult): void => {
    
    
    
    if (disabled) {
      return
    }
    if (called) {
      
      
      
      const duplicate = new NextCalledTwiceError()
      if (callbacks?.onError?.(duplicate)) {
        return
      }
      throw duplicate
    }
    called = true
    consume()
    if (callbacks?.holding) {
      callbacks.held.push({ error, value })
      return
    }
    advance?.(error, value, callbacks?.pipeIndex)
  }) as NextCallback
  wrapped.disable = (): void => {
    if (disabled) {
      return
    }
    disabled = true
    consume()
    advance = null
  }
  return wrapped
}

export default class Fetcher {
  
  private keys: string[] = []

  private _fetch: (
    container: PipeResult,
    args: PipeResult[],
    functions?: FunctionContainer,
    nextCallbacks?: NextCallbacks,
  ) => PipeOutput = this.fetchNothing

  
  
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
    const box = container as { [key: string]: PipeResult }
    if (Object.prototype.hasOwnProperty.call(box, key)) {
      return box[key]
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
    const box = container as { [key: string]: PipeResult }
    const wrapped = once(box.next as AnyFunction, nextCallbacks)
    if (nextCallbacks) {
      nextCallbacks.wrappers.push(wrapped)
    }
    return wrapped
  }

  
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
    const result: Record<string, PipeResult> = {}

    for (const key of this.keys) {
      
      
      if (key === 'next' && result.next !== undefined) {
        continue
      }
      result[key] = this.value(container, functions, key, nextCallbacks)
    }

    
    
    return this.raw ? result : [result]
  }
}
