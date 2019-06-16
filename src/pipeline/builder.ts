import Pipe, { InputPipe } from './Pipe'
import Fetcher from '../parameter/Fetcher'
import Producer from '../parameter/Producer'
import {
  PipeResult,
  PipeFunction, PipeParameter,
  isNonEmptyString, FunctionContainer,
} from '../common'

export enum FN_TYPE {
  END = 'end',
  ERROR = 'error',
  INPUT = 'input',
}

export function createPipe (
  fn: PipeFunction,
  input: PipeParameter,
  output: PipeParameter
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

    // It's an `optional` pipe if the name is ended with `?`.
    // The actual function name is the value without the question mark.
    pipe.optional = /\?$/.test(fn)
    if (pipe.optional) {
      fn = fn.slice(0, -1)
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

export function createInputPipe (input: PipeParameter): InputPipe {
  const pipe: InputPipe = {
    fnName: 'input',
    producer: new Producer(input),
  }

  return pipe
}

export function createErrorPipe (
  errorFn: PipeFunction,
  input: PipeParameter = 'error'
): Function {
  const fetcher = new Fetcher(input)

  if (fetcher.hasNext) {
    throw new Error('"next" could not be used in error pipe.')
  }

  let getErrorFn: Function

  if (isNonEmptyString(errorFn)) {
    const fnName: string = errorFn as string
    getErrorFn = function (
      container: PipeResult,
      functions: FunctionContainer
    ): Function {
      return container[fnName] || functions[fnName]
    }
  } else if (typeof errorFn === 'function') {
    getErrorFn = (): Function => errorFn
  } else {
    throw new Error('Error handler must be a string or function.')
  }

  return function errorHandler (
    container: PipeResult,
    functions: FunctionContainer
  ): void {
    const inputArgs = fetcher.fetch(container)
    const fn = getErrorFn(container, functions)
    if (typeof fn === 'function') {
      fn.apply(0, inputArgs)
    } else {
      throw new Error(`Error handler "${errorFn}" is not a function.`)
    }
  }
}
