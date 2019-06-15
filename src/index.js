import {
  createPipe,
  createInputPipe,
  createErrorPipe,
  createPipesFromDefs,
} from './pipeline/builder'
import { runPipeline } from './pipeline/executor'
import Fetcher from './argument/Fetcher'

class Pipeline {
  constructor (name, definitions, functions) {
    this.name = name
    this._pipes = []
    this.functions = { ...functions }
    if (Array.isArray(definitions)) {
      const end = createPipesFromDefs(this, definitions)
      return end || this
    }
  }

  input (input) {
    if (this._pipes.length > 0) {
      throw new Error('Input must be called before any other pipes.')
    }
    this._pipes.push(createInputPipe(input))
    return this
  }

  pipe (fn, input, output) {
    if (this.errorHandler) {
      throw new Error('Adding new pipe after error pipe is not allowed.')
    }
    const pipe = createPipe(fn, input, output)
    this._pipes.push(pipe)
    return this
  }

  error (fn, input) {
    if (this.errorHandler) {
      throw new Error('Each pipeline could only have one error handler.')
    }
    this.errorHandler = createErrorPipe(fn, input)
    return this
  }

  end (output) {
    const fetcher = new Fetcher(output, 'raw')
    // Make shallow copies of pipeline properties.
    const pipeline = {
      name: this.name,
      pipes: [ ...this._pipes ],
      functions: { ...this.functions },
      errorHandler: this.errorHandler,
    }

    return function (arg) {
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

export default function (functions) {
  return function (name, defs) {
    return new Pipeline(name, defs, functions)
  }
}

