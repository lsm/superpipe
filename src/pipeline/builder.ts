import {
  type AnyFunction,
  type FunctionContainer,
  isNonEmptyString,
  type PipeFunction,
  type PipeParameter,
  type PipeResult,
} from '../common'
import Fetcher from '../parameter/Fetcher'
import Producer from '../parameter/Producer'
import type Pipe from './Pipe'
import type { InputPipe } from './Pipe'

export enum FN_TYPE {
  END = 'end',
  ERROR = 'error',
  INPUT = 'input',
}

export function createPipe(
  fn: PipeFunction,
  input?: PipeParameter,
  output?: PipeParameter,
): Pipe | never {
  const pipe: Pipe = {
    fn: null,
    fnName: 'unknown',
    fetcher: new Fetcher(input),
    producer: new Producer(output),
    injected: false,
  }

  if (isNonEmptyString(fn)) {
    fn = fn as string

    pipe.not = /^!/.test(fn)
    if (pipe.not) {
      fn = fn.slice(1)
    }

    pipe.optional = /^\?/.test(fn)
    if (pipe.optional) {
      fn = fn.slice(1)
    }

    pipe.fnName = fn
    pipe.injected = true
  } else if (typeof fn === 'function') {
    pipe.fn = fn
    pipe.fnName = fn.name || 'anonymous'
  } else {
    throw new Error(`Unsupported pipe function type "${typeof fn}".`)
  }

  return pipe
}

export function createInputPipe(input: PipeParameter): InputPipe {
  const pipe: InputPipe = {
    fnName: 'input',
    producer: new Producer(input, 'input'),
  }

  return pipe
}

export function createErrorPipe(errorFn: PipeFunction, input?: PipeParameter): AnyFunction {
  const fetcher = new Fetcher(input === undefined ? 'error' : input)

  if (fetcher.hasNext) {
    throw new Error('"next" could not be used in error pipe.')
  }

  let getErrorFn: (container: PipeResult, functions: FunctionContainer) => unknown

  if (isNonEmptyString(errorFn)) {
    const fnName: string = errorFn as string
    getErrorFn = (container: PipeResult, functions: FunctionContainer): AnyFunction => {
      const box = container as Record<string, unknown>
      if (Object.prototype.hasOwnProperty.call(box, fnName)) {
        return box[fnName] as AnyFunction
      }
      return functions[fnName] as AnyFunction
    }
  } else if (typeof errorFn === 'function') {
    getErrorFn = (): AnyFunction => errorFn as AnyFunction
  } else {
    throw new Error('Error handler must be a string or function.')
  }

  return function errorHandler(
    container: PipeResult,
    functions: FunctionContainer,
    error?: Error,
  ): void {
    const source = Object.assign({}, container, { error })
    const inputArgs = fetcher.fetch(source, [], functions)
    const fn = getErrorFn(container, functions) as AnyFunction | undefined
    if (typeof fn === 'function') {
      ;(fn as (...args: PipeResult[]) => unknown)(...(inputArgs as PipeResult[]))
    } else {
      throw new Error(`Error handler "${errorFn}" is not a function.`)
    }
  }
}
