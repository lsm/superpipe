import Pipeline from './pipeline/Pipeline'
import { FN_TYPE } from './pipeline/builder'
import { PipeDefinition } from './pipeline/Pipe'
import { PipeFunction, PipeResult, FunctionContainer } from './common'

export default function superpipe<T extends FunctionContainer = FunctionContainer>(
  functions?: T
): (name: string, defs?: PipeDefinition[]) => Pipeline | Function {
  return function (name: string, defs?: PipeDefinition[]): Pipeline | Function {
    let end
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
            end = pipeline.end(input)
            break
          default:
            pipeline.pipe(
              fn,
              input,
              output
            )
        }
      })

      // Declarative definitions auto-finalize when no explicit end tuple
      // is present, so `const run = sp('name', defs)` returns an executor.
      return end || pipeline.end()
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
export type { default as Pipe, InputPipe } from './pipeline/Pipe'
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
export type PipeState = {
  step: number
  container: Store
  args: PipeResult[]
}
