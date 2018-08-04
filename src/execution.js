import { FN_INPUT } from './pipe'

export function executePipe(err, args, dep, store, pipeState) {
  var fn = pipeState.fn
  var next = pipeState.next
  var input = pipeState.input
  var output = pipeState.output
  var fnName = pipeState.fnName
  var _inputArgs
  var injectedFn

  if (input.length === 0) {
    _inputArgs = args
  } else {
    _inputArgs = input.map(key => {
      return store.hasOwnProperty(key) ? store[key] : dep[key]
    })
  }

  // An injection pipe. Get the pipe function demanded from dependency container.
  if (fn === null && 'string' === typeof fnName) {
    injectedFn = store.hasOwnProperty(fnName) ? store[fnName] : dep[fnName]

    if (
      pipeState.optional &&
      (-1 < _inputArgs.indexOf(undefined) || 'undefined' === typeof injectedFn)
    ) {
      // Optional pipe, go next if any of the dependencies or the function
      // itself is undefined.
      next()
      return
    }
  }

  let localSet = function(key, value) {
    setWithPipeState(store, pipeState, key, value)
  }

  if (output && output.length > 0) {
    if (true === pipeState.autoNext) {
      // Only track output when autoNext is true.
      pipeState.fulfilled = []
      // We will handle the auto next behaviour in setWithPipeState function.
      pipeState.autoNext = false
    }
    // Call customized set function instead.
    var indexOfSet = input.indexOf('set')
    if (indexOfSet > -1) {
      _inputArgs[indexOfSet] = localSet
    }
  }

  if (FN_INPUT === fnName) {
    pipeState.result = fn.call(0, args, store)
  } else if (injectedFn || false === injectedFn) {
    pipeState.result = executeInjectedFunc(_inputArgs, injectedFn, pipeState)
  } else {
    pipeState.result = fn.apply(0, _inputArgs)
  }

  pipeState.fnReturned = true

  // Call set if a plain object was returned
  if (isPlainObject(pipeState.result)) {
    localSet(pipeState.result)
  }

  // Check if we need to run next automatically when:
  // 1. result is true
  // 2. autoNext is true and no error and result is not false
  if (
    true === pipeState.result ||
    (pipeState.autoNext && !err && false !== pipeState.result)
  ) {
    next()
  }
}

export function setWithPipeState(store, pipeState, key, value) {
  // Error happens in previous `set` call, return to avoid call error handler twice.
  if (pipeState.hasError) {
    return
  }

  var next = pipeState.next
  var result = pipeState.result
  var output = pipeState.output
  var outputMap = pipeState.outputMap
  var fulfilled = pipeState.fulfilled
  var fnReturned = pipeState.fnReturned

  if ('string' === typeof key) {
    let nameTOCheck = key
    let mappedName = outputMap && outputMap[key]

    if (mappedName) {
      // Check against the mapping name
      nameTOCheck = key + ':' + mappedName
      // Set the mappedName as the real dependency name
      key = mappedName
    }
    checkFulfillment(nameTOCheck, pipeState, output, fulfilled)
    store.set(key, value)
  } else if (isPlainObject(key)) {
    Object.keys(key).forEach(function(propName) {
      let value = key[propName]
      let nameTOCheck = propName
      let mappedName = outputMap && outputMap[propName]
      if (mappedName) {
        // Check against the mapping name
        nameTOCheck = propName + ':' + mappedName
        // Set the original propName to mappedName so we set `mappedName` as
        // depenency name instead of `propName`
        propName = mappedName
      }
      checkFulfillment(nameTOCheck, pipeState, output, fulfilled)
      store.set(propName, value)
    })
  } else {
    throw new Error('Unsupported output key type.')
  }

  // Call next immediately if there is an error
  if (pipeState.hasError) {
    pipeState.autoNext = false
    next()
  } else if (fulfilled && fulfilled.length === output.length) {
    // Set the auto next to true or call next when all required
    // supplies are fulfilled.
    if (fnReturned && ('undefined' === typeof result || false !== result)) {
      // Function has been returned.
      // We should call next when the returned value is either
      // undefined or not false.
      next()
    } else {
      // `setWithPipeState` will only be called when autoNext was true
      // so set it back to true when we are not sure what to do and
      // let other part of the code to handle when to call next.
      pipeState.autoNext = true
    }
  }
}

function checkFulfillment(key, pipeState, output, fulfilled) {
  if ('error' === key) {
    pipeState.hasError = true
  } else if (-1 === output.indexOf(key)) {
    throw new Error(`Dependency "${key}" is not defined in output.`)
  }
  if (fulfilled && -1 === fulfilled.indexOf(key)) {
    fulfilled.push(key)
  }
}

/**
 * A function to handle different types of pipe functions.
 * It calls the original function and return the result if that is a function.
 * Or return the result directly for case like `boolean` value.
 */
function executeInjectedFunc(args, injectedFn, pipeState) {
  if ('function' === typeof injectedFn) {
    // Call it with the arguments passed in when it's a function.
    // We call it with `0` to prevent some JS engines injecting the
    // default `this`.
    var result = injectedFn.apply(0, args)
    // When the result is boolean we will need to consider if it's a `not`
    // pipe and alter the value based on that.
    if ('boolean' === typeof result) {
      return pipeState.not ? !result : result
    } else {
      return result
    }
  } else if ('boolean' === typeof injectedFn) {
    // Directly return the value when it is a boolean for flow control.
    return pipeState.not ? !injectedFn : injectedFn
  } else {
    // Throw an exception when the original function is not something
    // we understand.
    throw new Error(
      `Dependency "${pipeState.fnName}" is not a function or boolean.`
    )
  }
}

function isPlainObject(obj) {
  return 'object' === typeof obj ? obj && !Array.isArray(obj) : false
}
