import type {
  AsyncPipelineRunner,
  ExitHandler,
  FunctionContainer,
  PipeFunction,
  PipelineRunner,
  PipeParameter,
  ReasonHandler,
} from './common'
import { createPart, FN_TYPE, type Part } from './pipeline/builder'
import type { PipeDefinition } from './pipeline/Pipe'
import PipelineBuilder from './pipeline/Pipeline'

export default function superpipe<T extends FunctionContainer = FunctionContainer>(
  functions?: T,
): SuperPipeFactory {
  const owner = {}
  const factory = (name: string, defs?: PipeDefinition[]): PipelineAPI | PipelineRunner => {
    let endOutput: PipeParameter | undefined
    const pipeline = new PipelineBuilder(name, functions, owner)

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
  factory.steps = (name: string): Part => createPart(name, owner)
  return factory as SuperPipeFactory
}

export type {
  AbortSignalLike,
  AnyFunction,
  AsyncPipelineRunner,
  DescribedRunner,
  DescribedSpec,
  ExitHandler,
  FunctionContainer,
  PipeFunction,
  PipelineBase,
  PipelineDescription,
  PipelineExit,
  PipelineExitVia,
  PipelineRunner,
  PipeName,
  PipeOutput,
  PipeParameter,
  PipeRename,
  PipeResult,
  ReasonHandler,
  Result,
  ResultContainer,
  ResultReason,
  ResultValue,
  StepDescription,
} from './common'

export {
  AmbiguousContinuationError,
  NextCalledTwiceError,
  OutputKeyError,
  OutputNameError,
  PipelineAbortedError,
} from './common'
export type { Part } from './pipeline/builder'
export type { PipeDefinition, PipeDefinition as PipelineDefinition } from './pipeline/Pipe'
export type {
  InputSpec,
  OutputSpec,
  TypedAsyncRunner,
  TypedError,
  TypedFactory,
  TypedNext,
  TypedPipeline,
  TypedState,
} from './typed'
export { typed } from './typed'

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
  use: (part: Part) => PipelineAPI
  error: (fn: PipeFunction, input?: PipeParameter) => PipelineAPI

  onExit: (handler: ExitHandler) => PipelineAPI

  reason: (handler: ReasonHandler) => PipelineAPI

  end: (output?: PipeParameter) => PipelineRunner

  endAsync: (output?: PipeParameter) => AsyncPipelineRunner
}

export interface SuperPipeFactory {
  (name: string): PipelineAPI
  (name: string, defs: PipeDefinition[]): PipelineRunner
  (name: string, defs?: PipeDefinition[]): PipelineAPI | PipelineRunner
  steps(name: string): Part
}
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
