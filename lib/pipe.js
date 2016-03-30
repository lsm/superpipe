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

var setDepWithState = exports.setDepWithSupplies = function(state, name, dep, props) {
  var next = state.next
  var setDep = state.setDep
  var injector = state.injector
  var supplies = state.supplies
  var fulfilled = state.fulfilled
  var fnReturned = state.fnReturned

  var normalized = DEP.normalizeSetDepArgs(name, dep, props)
  var _props = normalized.props || (normalized.name ? [normalized.name] : [])

  // Whether dependency being injected is defined in `supplies`.
  foreach(_props, function(propName) {
    if (-1 === indexOf(supplies, propName))
      throw new Error('Dependency "' + propName + '" is not defined in supplies.')
    if (fulfilled && -1 === indexOf(fulfilled, propName))
      fulfilled.push(propName)
    return true
  })

  // Set the dependencies.
  setDep(name, dep, props)

  if (fulfilled && fulfilled.length === supplies.length) {
    // Set the auto next to true or call next when all required
    // supplies are fulfilled.
    if (fnReturned && ('undefined' === typeof result || false !== state.result)) {
      // Function has been returned.
      // We should call next when the returned value is either
      // undefined or not false.
      injector.set('setDep', setDep)
      next()
    } else {
      // Otherwise, let other part of the code to handle when to call next.
      state.autoNext = true
    }
  } else if (fulfilled && fulfilled.length > supplies.length) {
    throw new Error('Got more dependencies than what supplies required.')
  }
}

var executePipe = exports.executePipe = function(err, args, pipe, next, setDep, injector) {
  var fn = pipe.fn
  var deps = pipe.deps
  var supplies = pipe.supplies
  var fnName = pipe.fnName

  var state = {
    next: next,
    setDep: setDep,
    result: undefined,
    injector: injector,
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
    // Modify the `setDep`
    // Only track dependencies when autoNext is true.
    state.fulfilled = state.autoNext && []
    // We will handle the auto next behaviour.
    state.autoNext = false

    modifiedSetDep = function(name, deps, props) {
      setDepWithState(state, name, deps, props)
    }

    next.setDep = modifiedSetDep
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
  if (modifiedSetDep) {
    next.setDep = setDep
    injector.set('setDep', setDep)
  }

  // Check if we need to run next automatically when:
  // 1. result is true
  // 2. autoNext is true and no error and result is not false
  if (true === state.result || (state.autoNext && !err && false !== state.result))
    next()
}

var executeError = function(error, args, pipeline, pipes, step, injector) {
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

      var next = function(err) {
        var pipe
        if (err)
          pipe = executeError(err, args, pipeline, pipes, step, injector)
        else
          // get the right unit from the pipes array
          pipe = pipes[step++]
        if (pipe)
          executePipe(err, args, pipe, next, setDep, injector)
      }

      next.setDep = setDep
      // register `next` function as dependency
      injector.set('next', next)
      // start executing the chain
      next()
    }
  }
}

