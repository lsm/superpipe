import { FN_INPUT } from './pipe'
import { isPlainObject } from './set'

export function executePipe(args, store, pipeState) {
  const { fn, deps, fnName } = pipeState
  const inputArgs = getInputArgs(store, pipeState, args, deps)
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
  // 1. result is true
  // 2. autoNext is true and no error and result is not false
  if (
    true === pipeState.result ||
    (pipeState.autoNext && !pipeState.error && false !== pipeState.result)
  ) {
    store.next()
  }
}

function getInputArgs(store, pipeState, args, deps) {
  const { input, output } = pipeState

  if (input.length === 0) {
    // Use original function arguments as input if we don't have one.
    return args
  }

  const inputArgs = input.map(key => {
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
    }
    return store.hasOwnProperty(key) ? store[key] : deps[key]
  })

  if (output && output.length > 0) {
    if (pipeState.autoNext === true) {
      // Only track output when autoNext is true.
      pipeState.fulfilled = []
      // We will handle the auto next behaviour in setWithPipeState function.
      pipeState.autoNext = false
    }
    // `set` is only useful when output is defined. And in this case we need to
    // call customized set function instead.
    const indexOfSet = input.indexOf('set')
    if (indexOfSet > -1) {
      inputArgs[indexOfSet] = pipeState.set
    }
  }

  return inputArgs
}

function getInjectedFunction(store, pipeState, inputArgs) {
  const { fn, deps, fnName } = pipeState
  // An injection pipe. Get the pipe function from the store or the dependency
  // container.
  if (fn === null && 'string' === typeof fnName) {
    const injectedFn = store.hasOwnProperty(fnName)
      ? store[fnName]
      : deps[fnName]

    if (
      pipeState.optional &&
      (inputArgs.indexOf(undefined) > -1 || typeof injectedFn === 'undefined')
    ) {
      // Optional pipe, go next if any of the dependencies or the function
      // itself is undefined.

  store[key] = value
}
      return 0
    }

    return injectedFn
  }
}

/**
 * A function to handle different types of pipe functions.
 * It calls the original function and return the result if that is a function.
 * Or return the result directly for case like `boolean` value.
 */
function executeInjectedFunc(args, injectedFn, pipeState) {
  let result

  if ('function' === typeof injectedFn) {
    // Call it with the arguments passed in when it's a function.
    // We call it with `0` to prevent some JS engines injecting the
    // default `this`.
    result = injectedFn.apply(0, args)
  } else if ('boolean' === typeof injectedFn) {
    // Directly return the value when it is a boolean for flow control.
    result = injectedFn
  } else {
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
