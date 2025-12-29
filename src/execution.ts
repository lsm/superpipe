import { FN_INPUT } from './pipe'
import { isPlainObject } from './set'
import type { Store, PipeState, Dependencies } from './types'

export function executePipe(
  args: unknown[],
  store: Store,
  pipeState: PipeState
): void {
  const { fn, fnName } = pipeState

  if (FN_INPUT === fnName) {
    return (fn as (args: unknown[], store: Store) => void).call(0, args, store)
  }

  const inputArgs = getInputArgs(store, pipeState, args)
  const injectedFn = getInjectedFunction(store, pipeState, inputArgs)

  if (injectedFn === 0) {
    // Ignored optional pipe, go to next pipe.
    return store.next()
  }

  if (injectedFn || false === injectedFn) {
    pipeState.result = executeInjectedFunc(inputArgs, injectedFn, pipeState)
  } else {
    pipeState.result = (fn as (...args: unknown[]) => unknown).apply(0, inputArgs)
  }

  pipeState.fnReturned = true

  // Call set if a plain object was returned
  if (isPlainObject(pipeState.result)) {
    pipeState.set(pipeState.result as Record<string, unknown>)
  }

  // Check if we need to run next automatically when:
  // autoNext is true, no error and result is not false.
  if (pipeState.autoNext && !pipeState.error && pipeState.result !== false) {
    store.next()
  }
}

function getInputArgs(
  store: Store,
  pipeState: PipeState,
  args: unknown[]
): unknown[] {
  if (pipeState.input.length === 0) {
    return args
  }

  const { deps } = pipeState
  return pipeState.input.map(key => {
    if (key === 'next') {
      let called = false
      return function next(
        err?: unknown,
        key?: string | Record<string, unknown>,
        value?: unknown
      ): void {
        if (called) {
          throw new Error(
            '"next" should not be called more than once in a pipe.'
          )
        }
        called = true
        store.next(err, key, value)
      }
    } else if (key === 'set') {
      // Set function is local to a particular execution state.
      return pipeState.set
    }

    return getProp(key, store, deps)
  })
}

function getInjectedFunction(
  store: Store,
  pipeState: PipeState,
  inputArgs: unknown[]
): ((...args: unknown[]) => unknown) | boolean | 0 | undefined {
  const { fn, deps, fnName } = pipeState

  if (fn !== null || 'string' !== typeof fnName) {
    return undefined
  }

  // An injection pipe. Get the pipe function from the store or the dependency
  // container.
  const injectedFn = getProp(fnName, store, deps) as
    | ((...args: unknown[]) => unknown)
    | boolean
    | undefined

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
function executeInjectedFunc(
  args: unknown[],
  injectedFn: ((...args: unknown[]) => unknown) | boolean,
  pipeState: PipeState
): unknown {
  let result: unknown
  /* istanbul ignore next */
  const fnType = typeof injectedFn

  switch (fnType) {
    case 'function':
      // Call it with the arguments passed in when it's a function.
      // We call it with `0` to prevent some JS engines injecting the
      // default `this`.
      result = (injectedFn as (...args: unknown[]) => unknown).apply(0, args)
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

function getProp(key: string, store: Store, deps: Dependencies): unknown {
  return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : deps[key]
}
