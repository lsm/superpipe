import type { Store, PipeState } from './types'

export function setWithPipeState(
  store: Store,
  pipeState: PipeState,
  key: string | Record<string, unknown>,
  value?: unknown
): void {
  // Error happens in previous `set` call, return to avoid call error handler twice.
  if (pipeState.error) {
    return
  }

  if ('string' === typeof key) {
    setAndCheck(store, pipeState, key, value)
  } else if (isPlainObject(key)) {
    Object.keys(key).forEach(function(prop) {
      setAndCheck(store, pipeState, prop, (key as Record<string, unknown>)[prop])
    })
  } else {
    throw new Error('Unsupported output key type.')
  }

  checkSetAutoNext(store, pipeState)
}

export function isPlainObject(obj: unknown): obj is Record<string, unknown> {
  return 'object' === typeof obj ? obj !== null && !Array.isArray(obj) : false
}

function setAndCheck(
  store: Store,
  pipeState: PipeState,
  key: string,
  value: unknown
): void {
  const { output, fulfilled, outputMap } = pipeState
  let nameToCheck: string = key
  const mappedName = outputMap && outputMap[key]

  if (mappedName) {
    // Check against the mapping name
    nameToCheck = key + ':' + mappedName
    // Set the mappedName as the real dependency name
    key = mappedName
  }

  if (key === 'error') {
    pipeState.error = value
  } else {
    checkFulfillment(nameToCheck, pipeState, output, fulfilled)
  }

  store[key] = value
}

function checkFulfillment(
  key: string,
  pipeState: PipeState,
  output?: string[],
  fulfilled?: string[]
): void {
  if (!output || !fulfilled) {
    return
  }
  if (-1 === output.indexOf(key)) {
    throw new Error(`Dependency "${key}" is not defined in output.`)
  }
  if (fulfilled.indexOf(key) === -1) {
    fulfilled.push(key)
  }
}

function checkSetAutoNext(store: Store, pipeState: PipeState): void {
  const { output, result, autoNext, fulfilled, fnReturned } = pipeState
  // We should only check if we need to go next when all the conditions below
  // are satisfied:
  // 1. function is returned.
  // 2. result is not true.
  // 3. auto next is controlled by set.
  const checkNext = fnReturned && result !== false && autoNext === 0

  if (checkNext && fulfilled && output && fulfilled.length === output.length) {
    // Set auto next to false so the other part of the execution won't call
    // next again.
    pipeState.autoNext = false
    store.next()
  }
}
