import {
  createPipe,
  createInputPipe,
  createErrorPipe,
} from './builder'
import {
  PipeOutput,
  PipeResult,
  PipeFunction,
  PipelineBase,
  PipeParameter,
  FunctionContainer,
} from '../common'
import { runPipeline } from './executor'
import Fetcher from '../parameter/Fetcher'
import Pipe, { InputPipe } from './Pipe'

export default class Pipeline implements PipelineBase {
  name: string

  // Pipes of the pipeline.
  pipes: Pipe[] = []

  // Function container of the pipeline.
  functions: FunctionContainer

  inputPipe?: InputPipe

  errorHandler?: Function

  constructor (name: string, functions: FunctionContainer) {
    this.name = name
    this.functions = { ...functions }
  }

  input (input: PipeParameter): Pipeline {
    if (this.pipes.length > 0) {
      throw new Error('Input pipe must be the first pipe in the pipeline.')
    }

    this.inputPipe = createInputPipe(input)
    return this
  }

  pipe (
    fn: PipeFunction,
    input: PipeParameter, output: PipeParameter
  ): Pipeline {
    if (this.errorHandler) {
      throw new Error('Adding new pipe after error pipe is not allowed.')
    }
    const pipe = createPipe(fn, input, output)
    this.pipes.push(pipe)
    return this
  }

  error (fn: PipeFunction, input: PipeParameter): Pipeline {
    if (this.errorHandler) {
      throw new Error('Each pipeline could only have one error handler.')
    }
    this.errorHandler = createErrorPipe(fn, input)
    return this
  }

  end (output: PipeParameter): Function {
    const fetcher = new Fetcher(output, 'raw')
    // Make shallow copies of pipeline properties.
    const pipeline: PipelineBase = {
      name: this.name,
      pipes: [ ...this.pipes ],
      inputPipe: this.inputPipe,
      functions: { ...this.functions },
      errorHandler: this.errorHandler,
    }

    return function (arg: PipeResult): PipeOutput {
      let args
      let len = arguments.length
      if (len === 1) {
        args = arg
      } else if (len > 1) {
        args = Array.prototype.slice.apply(arguments)
      }

      // Start executing the pipeline.
      const container = runPipeline(args, pipeline)
      return fetcher.fetch(container)
    }
  }
}

