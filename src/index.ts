import Pipeline from './pipeline/Pipeline'
import { FN_TYPE } from './pipeline/builder'
import { PipeDefinition } from './pipeline/Pipe'
import { PipeFunction, PipeParameter, PipeResult, FunctionContainer } from './common'

export default function superpipe<T extends FunctionContainer = FunctionContainer>(
  functions?: T
): (name: string, defs?: PipeDefinition[]) => Pipeline | Function {
  return function (name: string, defs?: PipeDefinition[]): Pipeline | Function {
    // Output spec from an explicit end tuple, applied only after every
    // tuple has been processed so later definitions are not lost.
    let endOutput: PipeParameter | undefined
    const pipeline = new Pipeline(name, functions)

    if (Array.isArray(defs)) {
      defs.forEach(function (pipeDef: PipeDefinition): void {
        const [ fn, input, output ] = pipeDef
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
            pipeline.pipe(
              fn,
              input,
              output
            )
        }
      })

      // Declarative definitions always finalize, with the end tuple's
      // output when one was given, so `const run = sp('name', defs)`
      // returns an executor.
      return pipeline.end(endOutput)
    }

    return pipeline
  }
}

// Exports for library consumers. `Dependencies`, `PipelineAPI` and
// `PipelineDefinition` are aliases for the names master exported, kept for
// backwards compatibility.
export { Pipeline }
export type {
  PipeResult,
  PipeOutput,
  PipeFunction,
  PipeParameter,
  FunctionContainer,
  PipelineBase,
} from './common'
export type { PipeDefinition } from './pipeline/Pipe'
export type { PipeDefinition as PipelineDefinition } from './pipeline/Pipe'

// Compatibility type matching the shape master exported as `Pipe`.
export interface Pipe {
  fn: ((...args: unknown[]) => unknown) | null
  fnName: string | undefined
  input: string[]
  output?: string[]
  not?: boolean
  optional?: boolean
}
export type { FunctionContainer as Dependencies } from './common'
export type { Pipeline as PipelineAPI }

// Compatibility aliases for the remaining type names master exported.
export type SuperPipeFactory = (
  name: string,
  defs?: PipeDefinition[]
) => Pipeline | Function
export type Store = {
  next: (error?: Error, value?: PipeResult) => void
  error?: Error
  [key: string]: PipeResult
}
// Compatibility type matching the shape master exported as `PipeState`.
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
