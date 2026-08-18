import type Pipe from './pipeline/Pipe'
import type { InputPipe } from './pipeline/Pipe'

export const RE_IS_OBJ_STRING = /^{.+}$/

export class NextCalledTwiceError extends Error {
  constructor() {
    super('"next" could not be called more than once in a pipe.')
    this.name = 'NextCalledTwiceError'
  }
}

export class OutputNameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutputNameError'
  }
}

export class AmbiguousContinuationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AmbiguousContinuationError'
  }
}

export class PipelineAbortedError extends Error {
  readonly reason: unknown

  constructor(reason?: unknown) {
    super('Pipeline aborted.')
    this.name = 'AbortError'
    this.reason = reason
  }
}

export interface AbortSignalLike {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

export interface AsyncPipelineRunner {
  (...args: unknown[]): Promise<PipeOutput>
  withSignal(signal: AbortSignalLike, ...args: unknown[]): Promise<PipeOutput>
}

export function signalAborted(signal: AbortSignalLike): boolean {
  try {
    return signal.aborted === true
  } catch {
    return false
  }
}

export function signalReason(signal: AbortSignalLike): unknown {
  try {
    return signal.reason
  } catch {
    return undefined
  }
}

export type AnyFunction = (...args: never[]) => unknown

export type PipeResult = unknown
export type PipeOutput = PipeResult | PipeResult[] | { [key: string]: PipeResult }

export type PipeFunction = string | AnyFunction | Function

export type PipeName = string
export type PipeRename = `${string}:${string}`
export type PipeParameter = PipeName | PipeRename | string[]

export interface FunctionContainer {
  [key: string]: unknown
}

export interface PipelineBase {
  readonly name: string
  readonly pipes: Pipe[]
  readonly inputPipes?: InputPipe[]
  readonly functions: FunctionContainer
  readonly errorHandler?: AnyFunction
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

export function throwNoErrorHandlerError(error: unknown): never {
  if (error instanceof Error) {
    throw error
  }
  throw new Error(`Pipeline error: ${String(error)}`)
}
