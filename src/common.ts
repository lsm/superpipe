import Pipe, { InputPipe } from './pipeline/Pipe'

export const RE_IS_OBJ_STRING = /^{.+}$/

// Thrown when a pipe's `next` callback is invoked more than once. Surfaced
// as-is rather than wrapped in a PipelineError.
export class NextCalledTwiceError extends Error {
  constructor () {
    super('"next" could not be called more than once in a pipe.')
    this.name = 'NextCalledTwiceError'
  }
}

type AnyValue = any

export type PipeResult = AnyValue
export type PipeOutput = PipeResult | PipeResult[] | {[key: string]: PipeResult}
export type PipeFunction = string | Function
export type PipeParameter = string | string[]

export interface FunctionContainer {
  // Dependencies may also be raw booleans, usable as pipe flow control.
  [key: string]: Function | boolean;
}

export interface PipelineBase {
  readonly name: string;
  readonly pipes: Pipe[];
  readonly inputPipe?: InputPipe;
  readonly functions: FunctionContainer;
  readonly errorHandler?: Function;
}

function objectStringIsNotAllowed(item: string): string {
  if (RE_IS_OBJ_STRING.test(item)) {
    throw new Error(`Object string ${item} is not allowed in array argument`)
  }
  return item
}

export function objectStringToArray(objString: string): string[] {
  return objString
    .slice(1, -1)
    .split(',')
    .map((key): string => key.trim())
}

export function isNonEmptyString<T>(item: T): boolean {
  return item && 'string' === typeof item
}

export function isValidArrayParameters<T>(array: T): boolean {
  return (
    Array.isArray(array) &&
    array.length > 0 &&
    array.map(objectStringIsNotAllowed).every(isNonEmptyString)
  )
}

export function throwNoErrorHandlerError (
  error: Error, step: number,
  pipeline: PipelineBase
): never {
  const pipe = pipeline.pipes[step]
  const { name } = pipeline
  const { fnName } = pipe

  const err = new Error()
  err.name = 'PipelineError'
  err.message = `\nError was triggered in pipeline "${name}" step "${step}:[${fnName}]":\n(Tips: use .error(errorHandlerFn, 'error') to handle this error within your pipeline.)`
  err.stack = error.stack
  // Preserve the original exception for `instanceof` checks and inspection.
  err.cause = error

  throw err
}
