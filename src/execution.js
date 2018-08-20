import { FN_INPUT } from './pipe'
import { isPlainObject } from './set'

export function executePipe(args, store, pipeState) {
  const { fn, fnName } = pipeState

  if (FN_INPUT === fnName) {
    return fn.call(0, args, store)
  }
  const injectedFn = getInjectedFunction(store, pipeState, inputArgs)

  if (injectedFn === 0) {
    // Ignored optional pipe, go to next pipe.
    store.next()
    return
  }

  if (FN_INPUT === fnName) {
    pipeState.result = fn.call(0, args, store)
  } else if (injectedFn || false === injectedFn) {
    pipeState.result = executeInjectedFunc(inputArgs, injectedFn, pipeState)
  } else {
    pipeState.result = fn.apply(0, inputArgs)
  }

  pipeState.fnReturned = true

  // Call set if a plain object was returned
  if (isPlainObject(pipeState.result)) {
    pipeState.set(pipeState.result)
  }

  // Check if we need to run next automatically when:
  // autoNext is true, no error and result is not false.
  if (pipeState.autoNext && !pipeState.error && pipeState.result !== false) {
    store.next()
  }
}

function getInputArgs(store, pipeState, args, deps) {
  const { input } = pipeState

  if (input.length === 0) {
    // Use original function arguments as input if we don't have one.
    return args
  } else {
    return input.map(key => {
      if (key === 'next') {
        let called = false
        return function next(err, key, value) {
          if (called) {
            throw new Error(
              '"next" should not be called more than once in a pipe.'
            )
          }
          called = true
          return store.next(err, key, value)
        }
      } else if (key === 'set') {
        // Set function is local to a praticular execution state.
        return pipeState.set
      }
      return store.hasOwnProperty(key) ? store[key] : deps[key]
    })
  }
}

function getInjectedFunction(store, pipeState, inputArgs) {
  const { fn, deps, fnName } = pipeState

  if (fn !== null || 'string' !== typeof fnName) {
    return
  }

  // An injection pipe. Get the pipe function from the store or the dependency
  // container.
  const injectedFn = store.hasOwnProperty(fnName) ? store[fnName] : deps[fnName]

  if (
    pipeState.optional &&
    (inputArgs.indexOf(undefined) > -1 || typeof injectedFn === 'undefined')
  ) {
    // Optional pipe, go next if any of the dependencies or the function
    // itself is undefined.
    return 0
  }

  return injectedFn
}

/**
 * A function to handle different types of pipe functions.
 * It calls the original function and return the result if that is a function.
 * Or return the result directly for case like `boolean` value.
 */
function executeInjectedFunc(args, injectedFn, pipeState) {
  let result
  /* istanbul ignore next */
  const fnType = typeof injectedFn

  switch (fnType) {
    case 'function':
      // Call it with the arguments passed in when it's a function.
      // We call it with `0` to prevent some JS engines injecting the
      // default `this`.
      result = injectedFn.apply(0, args)
      break
    case 'boolean':
      // Directly return the value when it is a boolean for flow control.
      result = injectedFn
      break
    default:
      // Throw an exception when the original function is not something
      // we understand.
      throw new Error(
        `Pipeline [${pipeState.name}]: Dependency "${
          pipeState.fnName
        }" is not a function or boolean.`
      )
  }

  if ('boolean' === typeof result) {
    // When the result is boolean we will need to consider if it's a `not`
    // pipe and alter the value based on that.
    return pipeState.not ? !result : result
  }

  return result
}
