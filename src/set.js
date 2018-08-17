export function setWithPipeState(store, pipeState, key, value) {
  // Error happens in previous `set` call, return to avoid call error handler twice.
  if (pipeState.error) {
    return
  }

  if ('string' === typeof key) {
    setAndCheck(store, pipeState, key, value)
  } else if (isPlainObject(key)) {
    Object.keys(key).forEach(function(prop) {
      setAndCheck(store, pipeState, prop, key[prop])
    })
  } else {
    throw new Error('Unsupported output key type.')
  }

}

export function isPlainObject(obj) {
  return 'object' === typeof obj ? obj && !Array.isArray(obj) : false
}

function setAndCheck(store, pipeState, key, value) {
  const { output, fulfilled, outputMap } = pipeState
  let nameTOCheck = key
  let mappedName = outputMap && outputMap[key]

  if (mappedName) {
    // Check against the mapping name
    nameTOCheck = key + ':' + mappedName
    // Set the mappedName as the real dependency name
    key = mappedName
  }

  if (key === 'error') {
    pipeState.error = value
  } else {
    checkFulfillment(nameTOCheck, pipeState, output, fulfilled)
  }

  store[key] = value
}

function checkFulfillment(key, pipeState) {
  const { output, fulfilled } = pipeState
  if (-1 === output.indexOf(key)) {
    throw new Error(`Dependency "${key}" is not defined in output.`)
  }
  if (fulfilled.indexOf(key) === -1) {
    fulfilled.push(key)
  }
}
