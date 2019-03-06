import Fetcher from '../argument/Fetcher'
import Producer from '../argument/Producer'
import { isNonEmptyString } from '../argument/common'

const FN_END = 'end'
const FN_ERROR = 'error'
const FN_INPUT = 'input'

export function createPipe (fn, input, output) {
  const pipe = {
    fetcher: new Fetcher(input),
    producer: new Producer(output),
    injected: false
  }

  // fn is the name of the function being injected during execution.
  if (isNonEmptyString(fn)) {
    pipe.fn = null
    // It's a `not` pipe if the pipe name is started with `!`.
    // Although the actual funfromction name is the value without the exclamation mark.
    pipe.not = /^!/.test(fn)
    if (pipe.not) {
      fn = fn.slice(1)
    }

    // It's an `optional` pipe if the name is ended with `?`.
    // The actual function name is the value without the question mark.
    pipe.optional = /\?$/.test(fn)
    if (pipe.optional) {
      fn = fn.slice(0, -1)
    }

    // Set the original function name to the pipe object
    // for later dependency discovery.
    pipe.fnName = fn
    pipe.injected = true
  } else if (typeof fn === 'function') {
    pipe.fn = fn
    pipe.fnName = fn.name || 'anonymous'
  } else {
    throw new Error(`Unsupported pipe function "${fn}".`)
  }

  return pipe
}

export function createInputPipe (input) {
  const producer = new Producer(input)

  return {
    isInputPipe: true,
    producer
  }
}

export function createErrorPipe (errorFn, input = 'error') {
  const fetcher = new Fetcher(input)

  if (fetcher.hasNext) {
    throw new Error('"next" could not be used in error pipe.')
  }

  let getErrorFn

  if (isNonEmptyString(errorFn)) {
    getErrorFn = function (container, functions) {
      return container[errorFn] || functions[errorFn]
    }
  } else if (typeof errorFn === 'function') {
    getErrorFn = () => errorFn
  } else {
    throw new Error('Error handler must be a string or function.')
  }

  return function errorHandler (container, functions) {
    const inputArgs = fetcher.fetch(container)
    const fn = getErrorFn(container, functions)
    if (typeof fn === 'function') {
      fn.apply(0, inputArgs)
    } else {
      throw new Error(`Error handler "${errorFn}" is not a function.`)
    }
  }
}

export function createPipesFromDefs (pipeline, definitions) {
  let end

  definitions.forEach(function ([fn, input, output]) {
    switch (fn) {
      case FN_INPUT:
        pipeline.input(input)
        break
      case FN_ERROR:
        pipeline.error(input, output)
        break
      case FN_END:
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

  return end
}
