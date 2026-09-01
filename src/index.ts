import type { AsyncPipelineRunner, FunctionContainer, PipeFunction, PipeParameter } from './common'
import { FN_TYPE } from './pipeline/builder'
import type { PipeDefinition } from './pipeline/Pipe'
import PipelineBuilder from './pipeline/Pipeline'

export default function superpipe<T extends FunctionContainer = FunctionContainer>(
  functions?: T,
): SuperPipeFactory {
  return (name: string, defs?: PipeDefinition[]): PipelineAPI | ((...args: unknown[]) => void) => {
    let endOutput: PipeParameter | undefined
    const pipeline = new PipelineBuilder(name, functions)

    if (Array.isArray(defs)) {
      defs.forEach((pipeDef: PipeDefinition): void => {
        const [fn, input, output] = pipeDef
        switch (fn) {
          case FN_TYPE.INPUT:
            pipeline.input(input)
            break
          case FN_TYPE.ERROR:
            pipeline.error(input as PipeFunction, output)
            break
          case FN_TYPE.END:
            endOutput = input
            break
          default:
            pipeline.pipe(fn, input, output)
        }
      })

      return pipeline.end(endOutput)
    }

    return pipeline
  }
}

export type {
  AbortSignalLike,
  AnyFunction,
  AsyncPipelineRunner,
  FunctionContainer,
  PipeFunction,
  PipelineBase,
  PipeName,
  PipeOutput,
  PipeParameter,
  PipeRename,
  PipeResult,
  Result,
  ResultReason,
  ResultValue,
} from './common'

export {
  AmbiguousContinuationError,
  NextCalledTwiceError,
  OutputKeyError,
  OutputNameError,
  PipelineAbortedError,
} from './common'
export type { PipeDefinition, PipeDefinition as PipelineDefinition } from './pipeline/Pipe'

export interface Pipeline {
  name: string
  pipes: Pipe[]
  errorHandler?: Pipe
  deps: FunctionContainer
}

export interface Pipe {
  fn: ((...args: unknown[]) => unknown) | null
  fnName: string | undefined
  input: string[]
  output?: string[]
  not?: boolean
  optional?: boolean
}
export type { FunctionContainer as Dependencies } from './common'

export interface PipelineAPI {
  input: (input?: PipeParameter) => PipelineAPI
  pipe: (fn: PipeFunction, input?: PipeParameter, output?: PipeParameter) => PipelineAPI
  error: (fn: PipeFunction, input?: PipeParameter) => PipelineAPI

  end: (output?: PipeParameter) => Function

  endAsync: (output?: PipeParameter) => AsyncPipelineRunner
}

export type SuperPipeFactory = (
  name: string,
  defs?: PipeDefinition[],
) => PipelineAPI | ((...args: unknown[]) => void)
export type Store = {
  next: (error?: unknown, value?: unknown) => void
  error?: unknown
  [key: string]: unknown
}

export interface PipeState {
  fn: ((...args: unknown[]) => unknown) | null
  not?: boolean
  deps: FunctionContainer
  input: string[]
  output?: string[]
  fnName: string | undefined
  autoNext: boolean | 0
  optional?: boolean
  name: string
  error?: unknown
  result?: unknown
  fnReturned?: boolean
}
