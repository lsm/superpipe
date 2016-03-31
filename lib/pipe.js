'use strict'

/**
 * Module dependencies
 */
var DEP = require('./dep')
var toArray = require('lodash.toarray')
var foreach = require('lodash.foreach')
var indexOf = require('lodash.indexof')
var Injector = require('insider')
var isPlainObject = require('lodash.isplainobject')
var ERROR_NAME = 'error'

var setDepWithState = exports.setDepWithState = function(state, name, dep, props) {
  var next = state.next
  var result = state.result
  var setDep = state.setDep
  var supplies = state.supplies
  var fulfilled = state.fulfilled
  var fnReturned = state.fnReturned

  var normalized = DEP.normalizeSetDepArgs(name, dep, props)
  var _props = normalized.props || (normalized.name ? [normalized.name] : [])

  // Error happens in previous setDep call return to avoid call error handler twice.
  if (state.hasError)
    return

  // Whether dependency being injected is defined in `supplies`.
  foreach(_props, function(propName) {
    if (propName === ERROR_NAME)
      state.hasError = true
    if (-1 === indexOf(supplies, propName) && propName !== ERROR_NAME)
      throw new Error('Dependency "' + propName + '" is not defined in supplies.')
    if (fulfilled && -1 === indexOf(fulfilled, propName))
      fulfilled.push(propName)
  })

  // Set the dependencies.
  setDep(name, dep, props)

  // Call next immediately if there is an error
  if (state.hasError) {
    state.autoNext = false
    next()
  } else if (fulfilled) {
    if (fulfilled.length === supplies.length) {
      // Set the auto next to true or call next when all required
      // supplies are fulfilled.
      if (fnReturned && ('undefined' === typeof result || false !== result))
        // Function has been returned.
        // We should call next when the returned value is either
        // undefined or not false.
        next()
      else
        // Otherwise, let other part of the code to handle when to call next.
        state.autoNext = true
    } else if (fulfilled.length > supplies.length) {
      throw new Error('Got more dependencies than what supplies required.')
    }
  }
}

var executePipe = exports.executePipe = function(err, args, pipe, next, setDep, injector) {
  var fn = pipe.fn
  var deps = pipe.deps
  var fnName = pipe.fnName
  var supplies = pipe.supplies

  var state = {
    next: next,
    setDep: setDep,
    result: undefined,
    fnReturned: false,
    supplies: supplies,
    // No deps or has deps but next is not required as dependency.
    autoNext: !deps || -1 === indexOf(deps, 'next')
  }

  // Get the pipe function demanded from dependency container.
  if ('string' === typeof fnName)
    // Set it as the original pipe function
    pipe.ofn = injector.get(fnName)

  if (pipe.optional) {
    // Optional pipe, go next if we can't get all dependencies.
    var _deps = injector.getAll(deps)
    if (-1 < _deps.indexOf(undefined)) {
      next()
      return
    }
  }

  var modifiedSetDep
  if (supplies && 0 < supplies.length) {
    if (true === state.autoNext) {
      // Only track dependencies when autoNext is true.
      state.fulfilled = []
      // We will handle the auto next behaviour in setDepWithState function.
      state.autoNext = false
    }
    // Call customized setDep function instead.
    modifiedSetDep = function(name, dep, props) {
      setDepWithState(state, name, dep, props)
    }
    injector.set('setDep', modifiedSetDep)
  }

  // Run the actual function
  var _args = injector.getAll(deps, args)
  state.result = fn.apply(0, _args)
  state.fnReturned = true

  // Call setDep if a plain object was returned
  if (isPlainObject(state.result))
    (modifiedSetDep || setDep)(state.result)

  // Ensure to put back the original `setDep` function if modified.
  if (modifiedSetDep)
    injector.set('setDep', setDep)

  // Check if we need to run next automatically when:
  // 1. result is true
  // 2. autoNext is true and no error and result is not false
  if (true === state.result || (state.autoNext && !err && false !== state.result))
    next()
}

exports.toPipe = function(pipeline, pipes, superpipe) {
  pipes = pipes || pipeline.pipes

  if (superpipe)
    pipeline.connect(superpipe)
  else
    superpipe = pipeline.superpipe

  if (!superpipe)
    throw new Error('Pipeline is not connected to superpipe instance')

  return function() {
    if (pipes[0]) {
      var step = 0
      var args = toArray(arguments)
      var injector = new Injector(pipeline.injector)

      var setDep = function(name, dep, props) {
        DEP.setDep(superpipe, injector, name, dep, props)
      }

      // local deps setter unique for each pipeline
      injector.set('setDep', setDep)

      if (superpipe) {
        // Global dependencies setter for sharing states cross pipelines.
        injector.set('set', function(name, dep, props) {
          DEP.setDep(superpipe, superpipe.injector, name, dep, props)
          setDep(name, dep, props)
        })
      }

      var next = function(err, name, dep, props) {
        if (arguments.length > 1)
          setDep(name, dep, props)

        // Should execute error pipe when `error` could be found in injector.
        if (err)
          injector.set('error', err)
        else
          err = injector.get('error')

        var pipe
        if (err)
          pipe = getErrorPipe(err, args, pipeline, pipes, step, injector)
        else
          // get the right unit from the pipes array
          pipe = pipes[step++]
        if (pipe)
          executePipe(err, args, pipe, next, setDep, injector)
      }

      // register `next` function as dependency
      injector.set('next', next)
      // start executing the chain
      next()
    }
  }
}

/**
 * Private functions
 */

function getErrorPipe(error, args, pipeline, pipes, step, injector) {
  if (pipeline.errorHandler) {
    // error handler fn as a pipe
    var pipe = pipeline.errorHandler
    var previousPipe = pipes[step - 1]
    if (previousPipe && previousPipe.fnName) {
      var ofn = previousPipe.ofn || previousPipe.fn.__original_fn__
      injector.set('errPipeName', previousPipe.fnName)
      injector.set('errPipeBody', 'function' === typeof ofn ? ofn.toString() : undefined)
    }
    // assign the err object to the first argument
    // so the error handler can get the error later
    args[0] = error
    return pipe
  }

  var ex = error
  if ('string' === typeof error) {
    ex = new Error()
    ex.name = 'Pipeline has no error handler function'
    ex.message = error
  }
  throw ex
}

