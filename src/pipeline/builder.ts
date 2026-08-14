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

  // fn is the name of the function being injected during execution.
  if (isNonEmptyString(fn)) {
    fn = fn as string
    // It's a `not` pipe if the pipe name is started with `!`.
    // The actual funfromction name is the value without the exclamation mark.
    pipe.not = /^!/.test(fn)
    if (pipe.not) {
      fn = fn.slice(1)
    }

    // It's an `optional` pipe if the name is started with `?`.
    // The actual function name is the value without the question mark.
    pipe.optional = /^\?/.test(fn)
    if (pipe.optional) {
      fn = fn.slice(1)
    }

    // Set the original function name to the pipe object
    // for later dependency discovery.
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

  let getErrorFn: AnyFunction

  if (isNonEmptyString(errorFn)) {
    const fnName: string = errorFn as string
    getErrorFn = (container: PipeResult, functions: FunctionContainer): AnyFunction => {
      if (Object.prototype.hasOwnProperty.call(container, fnName)) {
        return container[fnName] as AnyFunction
      }
      return functions[fnName] as AnyFunction
    }
  } else if (typeof errorFn === 'function') {
    getErrorFn = (): AnyFunction => errorFn
  } else {
    throw new Error('Error handler must be a string or function.')
  }

  return function errorHandler(container: PipeResult, functions: FunctionContainer): void {
    const inputArgs = fetcher.fetch(container, [], functions)
    const fn = getErrorFn(container, functions)
    if (typeof fn === 'function') {
      fn.apply(0, inputArgs)
    } else {
      throw new Error(`Error handler "${errorFn}" is not a function.`)
    }
  }
}
