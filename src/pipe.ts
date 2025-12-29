import type { Pipe } from './types'

export const FN_ERROR = 'error'
export const FN_INPUT = 'input'

/**
 * Put function and its dependencies to the pipeline.
 *
 * @param  fn - Function: The pipe function. String: Name of the dependent function.
 * @param  input - String or array of names of dependencies.
 * @param  output - String or array of names of outputs.
 * @return Pipe object.
 */
export function createPipe(
  fn: ((...args: unknown[]) => unknown) | string,
  input?: string | string[],
  output?: string | string[]
): Pipe {
  const fnType = typeof fn

  if ('string' === fnType && fn) {
    switch (fn) {
      case FN_INPUT:
        // .pipe('input', ['input1', 'input2'])
        inputIsRequired(input, FN_INPUT)
        return createInputPipe(input!)
      case FN_ERROR:
        // .pipe('error', 'theErrorHandler', ['input1', 'input2'])
        return createErrorPipe(input as string | ((...args: unknown[]) => unknown), output)
      default:
        return createInjectionPipe(fn as string, input, output)
    }
  } else if ('function' === fnType) {
    return buildPipe(fn as (...args: unknown[]) => unknown, input, output)
  }

  throw new Error(`Unsupported pipe function type "${fnType}".`)
}

function createInputPipe(input: string | string[]): Pipe {
  const normalizedInput = normalizeInput(input)

  const inputPipe = function(args: unknown[], store: { [key: string]: unknown; next: () => void }): void {
    normalizedInput.forEach((item, idx) => (store[item] = (args as unknown[])[idx]))
    store.next()
  }

  return {
    fn: inputPipe as unknown as ((...args: unknown[]) => unknown),
    fnName: FN_INPUT,
    input: normalizedInput
  }
}

function createErrorPipe(
  errorFn: string | ((...args: unknown[]) => unknown),
  input?: string | string[]
): Pipe {
  const normalizedInput = normalizeInput(input || 'error')

  if ('string' === typeof errorFn) {
    return {
      fn: null,
      fnName: errorFn,
      input: normalizedInput
    }
  } else if ('function' === typeof errorFn) {
    return {
      fn: errorFn,
      fnName: errorFn.name || FN_ERROR,
      input: normalizedInput
    }
  }

  throw new Error('Error handler must be a string or function')
}

/**
 * Create a pipe where the function is a dynamic value which will be injected
 * from the store at execution time.
 *
 * @param  name - Name of the pipe function
 * @param  input - Name of input or array of names of inputs.
 * @param  output - Name of output or array of names of outputs.
 * @return Pipe definition object.
 */
function createInjectionPipe(
  name: string,
  input?: string | string[],
  output?: string | string[]
): Pipe {
  // Build the pipe.
  const pipe = buildPipe(null, input, output)

  // It's a `not` pipe if the pipe name is started with `!`.
  // Although the actual function name is the value without the exclamation mark.
  pipe.not = /^!/.test(name)

  // It's an `optional` pipe if the name is started with `?`.
  // The actual function name is the value without the question mark.
  pipe.optional = /^\?/.test(name)

  if (pipe.not || pipe.optional) {
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
 * @param  fn - The pipe function
 * @param  input - String or array of names of inputs.
 * @param  output - String or array of names of outputs.
 * @return Pipe definition object.
 */
function buildPipe(
  fn: ((...args: unknown[]) => unknown) | null,
  input?: string | string[],
  output?: string | string[]
): Pipe {
  const normalizedInput = normalizeInput(input)
  const normalizedOutput = normalizeOutput(output)

  // Return pipe object with function and its metadata.
  return {
    // Original function or null for injection pipe. It should never be changed.
    fn: fn,
    fnName: fn && fn.name ? fn.name : undefined,
    // loading/generating pipe functions dynamically.
    input: normalizedInput,
    output: normalizedOutput
  }
}

function inputIsRequired(input: string | string[] | undefined, fnType: string): void {
  if (!input) {
    throw new Error(`"input" is required for "${fnType}" pipe.`)
  }
}

function normalizeInput(input?: string | string[]): string[] {
  let result: string[]

  if ('string' === typeof input) {
    result = [input]
  } else {
    // Allow empty input
    result = input || []
  }

  if (!Array.isArray(result) || !result.every(mustBeNonEmptyString)) {
    throw new Error(
      'Pipe requires non-empty string or array of non-empty strings as input.'
    )
  }

  return result
}

function normalizeOutput(output?: string | string[]): string[] {
  let result: string[]

  if ('string' === typeof output) {
    result = [output]
  } else {
    result = output || []
  }

  if (!Array.isArray(result) || !result.every(mustBeNonEmptyString)) {
    throw new Error(
      'Pipe requires non-empty string or array of non-empty strings as output.'
    )
  }

  return result
}

function mustBeNonEmptyString(item: unknown): boolean {
  return Boolean(item) && 'string' === typeof item
}
