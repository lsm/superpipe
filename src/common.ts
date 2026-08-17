import type Pipe from './pipeline/Pipe'
import type { InputPipe } from './pipeline/Pipe'

export const RE_IS_OBJ_STRING = /^{.+}$/

// Thrown when a pipe's `next` callback is invoked more than once. Surfaced
// as-is rather than wrapped in a PipelineError.
export class NextCalledTwiceError extends Error {
  constructor() {
    super('"next" could not be called more than once in a pipe.')
    this.name = 'NextCalledTwiceError'
  }
}

// Thrown when a pipe output or invocation input collides with a reserved
// control name or a configured dependency. Surfaced as-is rather than
// dispatched to the pipeline's error handler — a namespace violation is a
// programming error in the pipeline definition, not a runtime failure.
export class OutputNameError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutputNameError'
  }
}

// Thrown when a pipe declares `next` as an input and also returns a
// thenable — both are continuation channels and the executor refuses to
// guess which one advances the pipeline.
export class AmbiguousContinuationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AmbiguousContinuationError'
  }
}

// Rejection reason for an `endAsync` run cancelled through its AbortSignal.
// Carries the conventional `AbortError` name so consumers branching on
// `error.name` keep working, while remaining `instanceof
// PipelineAbortedError` for library-specific handling. `reason` is the
// signal's abort reason, preserved so callers can tell *why* it aborted.
export class PipelineAbortedError extends Error {
  readonly reason: unknown

  constructor(reason?: unknown) {
    super('Pipeline aborted.')
    this.name = 'AbortError'
    this.reason = reason
  }
}

// Minimal structural view of the standard AbortSignal. The library compiles
// against ES2022 with no DOM/Node ambient types, so the global AbortSignal
// type is unavailable; accepting this shape keeps `endAsync` compatible with
// any AbortController or polyfill.
export interface AbortSignalLike {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

// Options accepted by `endAsync`. Cancellation is opt-in: without a signal
// the run behaves exactly as before. `null` is tolerated like an absent
// signal — consumers often hold `AbortSignal | null` for optional
// controllers.
export interface EndAsyncOptions {
  readonly signal?: AbortSignalLike | null
}

// Read a signal's aborted flag defensively: a polyfill's getter may throw,
// and a failure there must not break the returned promise. A throwing getter
// reads as not-aborted, letting the normal path proceed.
export function signalAborted(signal: AbortSignalLike): boolean {
  try {
    return signal.aborted === true
  } catch {
    return false
  }
}

// Read a signal's abort reason defensively: a non-standard signal (or
// polyfill) may not expose one, and a throwing getter must not break the
// rejection path.
export function signalReason(signal: AbortSignalLike): unknown {
  try {
    return signal.reason
  } catch {
    return undefined
  }
}

// Generic callable — the runtime accepts any function shape
// (next callbacks, pipe fns, error handlers) and validates at the call
// site. The `never[]` parameters make every concrete signature assignable
// without `any`; return values are `unknown` and narrowed by the executor.
export type AnyFunction = (...args: never[]) => unknown

// Values flowing through a pipeline — invocation arguments, container
// data, pipe results — are `unknown` at the contract level; the executor
// narrows (thenable, boolean, object) at each use site.
export type PipeResult = unknown
export type PipeOutput = PipeResult | PipeResult[] | { [key: string]: PipeResult }
// `Function` stays in the public union for backwards compatibility:
// 0.15.0 accepted variables typed as Function; a lint migration must not
// narrow the public contract. Internal call sites use AnyFunction.
// biome-ignore lint/complexity/noBannedTypes: public API compatibility
export type PipeFunction = string | AnyFunction | Function

// Pipe input/output specs are name lists; the `source:destination` rename
// form selects a destination other than the produced name.
export type PipeName = string
export type PipeRename = `${string}:${string}`
export type PipeParameter = PipeName | PipeRename | string[]

export interface FunctionContainer {
  // Dependencies are callables, raw booleans (flow control), or data values
  // injected as pipe inputs.
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
  // Surface Error instances as-is — wrapping them would change their
  // identity and class for `instanceof` checks downstream. Other values
  // (strings, objects thrown as errors) are wrapped so callers always
  // receive an Error with a message and stack.
  if (error instanceof Error) {
    throw error
  }
  throw new Error(`Pipeline error: ${String(error)}`)
}
