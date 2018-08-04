export const FN_ERROR = 'error'
export const FN_INPUT = 'input'

/**
 * Put function and its dependencies to the pipeline.
 *
 * @param  {Function|String}  fn
 *         - Function: The pipe function.
 *         - String: Name of the dependent function.
 * @param  {Array|String}     input String or array of names of dependencies.
 * @param  {Array|String}     output String or array of names of outputs.
 * @return {Object}           Pipe object.
 */
export function createPipe(fn, input, output) {
  var fnType = typeof fn

  if ('string' === fnType && fn) {
    switch (fn) {
      case FN_INPUT:
        // .pipe('input', ['input1', 'input2'])
        inputIsRequired(input, FN_INPUT)
        return createInputPipe(input)
      case FN_ERROR:
        // .pipe('error', 'theErrorHandler', ['input1', 'input2'])
        return createErrorPipe(input, output)
      default:
        return createInjectionPipe(fn, input, output)
    }
  } else if ('function' === fnType) {
    return buildPipe(fn, input, output)
  }

  throw new Error(`Unsupported pipe function type "${fnType}".`)
}

function createInputPipe(input) {
  input = normalizeInput(input)

  return {
    fn: function inputPipe(args, store) {
      input.forEach((item, idx) => (store[item] = args[idx]))
      return true
    },
    fnName: FN_INPUT,
    input: input
  }
}

function createErrorPipe(errorFn, input) {
  input = normalizeInput(input || 'error')

  if ('string' === typeof errorFn) {
    return {
      fn: null,
      fnName: errorFn,
      input
    }
  } else if ('function' === typeof errorFn) {
    return {
      fn: errorFn,
      fnName: errorFn.name || FN_ERROR,
      input
    }
  }

  throw new Error('Error handler must be a string or function')
}

/**
 * Create a pipe where the function is a dynamic value which will be injected
 * from the store at execution time.
 *
 * @param  {String}         name    Name of the pipe function
 * @param  {Array|String}   input   Name of input or array of names of inputs.
 * @param  {Array|String}   output  Name of output or array of names of outputs.
 * @return {Object}                 Pipe definition object.
 */
function createInjectionPipe(name, input, output) {
  // Build the pipe.
  var pipe = buildPipe(null, input, output)

  // It's a `not` pipe if the pipe name is started with `!`.
  // Although the actual function name is the value without the exclamation mark.
  if (/^!/.test(name)) {
    pipe.not = true
    name = name.slice(1)
  }

  // It's an `optional` pipe if the name is started with `?`.
  // The actual function name is the value without the question mark.
  if (/^\?/.test(name)) {
    pipe.optional = true
    name = name.slice(1)
  }

  // Set the original function name to the pipe object
  // for later dependency discovery.
  pipe.fnName = name
  return pipe
}

/**
 * The actual function for building a pipe.
 *
 * @param  {Function}       fn      The pipe function
 * @param  {Array|String}   input   String or array of names of inputs.
 * @param  {Array|String}   output  String or array of names of outputs.
 * @return {Object}                 Pipe definition object.
 */
function buildPipe(fn, input, output) {
  input = normalizeInput(input)
  output = normalizeOutput(output)

  // Return pipe object with function and its metadata.
  return {
    // Original function or null for injection pipe. It should never be changed.
    fn: fn,
    // loading/generating pipe functions dynamically.
    input: input,
    // `output` contains `output` array and `outputMap` object.
    output: output.output,
    outputMap: output.outputMap,
    // Set `autoNext` flag to true when no input is required
    // or has input but next is not required as dependency.
    autoNext: !input || -1 === input.indexOf('next')
  }
}

function inputIsRequired(input, fnType) {
  if (!input) {
    throw new Error(`"input" is required for "${fnType}" pipe.`)
  }
}

function normalizeInput(input) {
  if ('string' === typeof input) {
    input = [input]
  } else {
    // Allow empty input
    input = input || []
  }

  if (
    !Array.isArray(input) ||
    !input.every(item => 'string' === typeof item && item)
  ) {
    throw new Error(
      'Pipe requires non-empty string or array of non-empty strings as input.'
    )
  }

  return input
}

function normalizeOutput(output) {
  if ('string' === typeof output) {
    output = [output]
  }

  if (
    output &&
    (!Array.isArray(output) ||
      !output.every(item => 'string' === typeof item && item))
  ) {
    throw new Error(
      'Pipe requires non-empty string or array of non-empty strings as output.'
    )
  }

  output = output || []

  // Detect any mapped output. Use the format `theOriginalName:theNewName` in
  // `output` array will map the output `theOriginalName` to `theNewName`.
  var i = 0
  var len = output.length
  var outputMap

  while (i < len) {
    var item = output[i++]
    if (/:/.test(item)) {
      outputMap = outputMap || {}
      var mapping = item.split(':')
      outputMap[mapping[0]] = mapping[1]
    }
  }

  return {
    output: output,
    outputMap: outputMap
  }
}
