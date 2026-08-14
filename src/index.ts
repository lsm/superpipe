import Pipeline from './pipeline/Pipeline'
import { FN_TYPE } from './pipeline/builder'
import { PipeDefinition } from './pipeline/Pipe'
import { PipeFunction, FunctionContainer } from './common'

export default function superpipe<T extends FunctionContainer>(
  functions: T
): (name: string, defs: PipeDefinition[]) => Pipeline | Function {
  return function (name: string, defs: PipeDefinition[]): Pipeline | Function {
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
    }

    return end || pipeline
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
export type { FunctionContainer as Dependencies } from './common'
export type { Pipeline as PipelineAPI }
