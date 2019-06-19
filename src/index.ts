import Pipeline from './pipeline/Pipeline'
import { FN_TYPE } from './pipeline/builder'
import { PipeDefinition } from './pipeline/Pipe'
import { PipeFunction, FunctionContainer } from './common'

export default function (functions: FunctionContainer): Function {
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

