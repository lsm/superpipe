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
  var setDepMap = state.setDepMap
  var fulfilled = state.fulfilled
  var fnReturned = state.fnReturned

  var normalized = DEP.normalizeSetDepArgs(name, dep, props)
  var _dep = normalized.dep
  var _name = normalized.name
  var _props = normalized.props


  // Error happens in previous setDep call return to avoid call error handler twice.
  if (state.hasError)
    return

  if (_name && !_props) {
    var checkName = _name
    var mappedName = setDepMap && setDepMap[_name]
    if (mappedName) {
      // Check against the mapping name
      checkName = _name + ':' + mappedName
      // Set the mappedName as the real dependency name
      _name = mappedName
    }
    checkFulfillment(checkName, state, supplies, fulfilled)
    setDep(_name, _dep)
  } else if (_dep && _props) {
    foreach(_props, function(propName, idx) {
      var nameTOCheck = propName
      var mappedName = setDepMap && setDepMap[propName]
      if (mappedName) {
        // Check against the mapping name
        nameTOCheck = propName + ':' + mappedName
        // Link the propName to the mappedName in _dep
        _dep[mappedName] = _dep[propName]
        // Set the original propName to mappedName so we set `mappedName` as
        // depenency name instead of `propName`
        _props[idx] = mappedName
      }
      checkFulfillment(nameTOCheck, state, supplies, fulfilled)
    })
    setDep(_dep, _props)
  } else {
    throw new Error('Unsupported arguments for in pipe `setDep`.')
  }

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
    supplies: supplies,
    // No deps or has deps but next is not required as dependency.
    autoNext: !deps || -1 === indexOf(deps, 'next'),
    setDepMap: pipe.setDepMap,
    fnReturned: false
  }

  // Get the pipe function demanded from dependency container.
  if ('string' === typeof fnName) {
    // Set it as the original pipe function
    pipe.ofn = injector.get(fnName)
    if (pipe.optional) {
      // Optional pipe, go next if we can't get all dependencies.
      var _deps = injector.getAll(deps)
      if (-1 < indexOf(_deps, undefined)) {
        next()
        return
      }
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
  // Ensure to put back the original `setDep` function if modified.
  if (modifiedSetDep)
    injector.set('setDep', setDep)

  state.result = fn.apply(0, _args)
  state.fnReturned = true

  // Call setDep if a plain object was returned
  if (isPlainObject(state.result))
    (modifiedSetDep || setDep)(state.result)

  // Check if we need to run next automatically when:
  // 1. result is true
  // 2. autoNext is true and no error and result is not false
  if (true === state.result || (state.autoNext && !err && false !== state.result))
    next()
}

exports.toPipe = function(pipeline, pipes, pipelineName) {
  pipes = pipes || pipeline.pipes

  var _injector = pipeline.injector
  var _superpipe = pipeline.superpipe


  var debug = pipeline.debug()
  if (debug)
    pipes = addDebugPipes(pipes, pipelineName, 'function' === typeof debug ? debug : null)

  return function() {
    if (pipes[0]) {
      var step = 0
      var args = toArray(arguments)
      var injector = new Injector(_injector)

      var setDep = function(name, dep, props) {
        DEP.setDep(_superpipe, injector, name, dep, props)
      }

      // local deps setter unique for each pipeline
      injector.set('setDep', setDep)

      if (_superpipe) {
        // Global dependencies setter for sharing states cross pipelines.
        injector.set('set', function(name, dep, props) {
          DEP.setDep(_superpipe, _injector, name, dep, props)
          setDep(name, dep, props)
        })
      }

      var next = function next(err, name, dep, props) {
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

var log = 'undefined' !== typeof console ? console.log : function() {}
function addDebugPipes(pipes, name, debug) {
  var _pipes = []
  name = name || 'pipeline'
  debug = debug || log
  foreach(pipes, function(pipe, idx) {

    var beforePipe = {
      fn: function() {
        var args = formatArguments(arguments)
        var fnName = pipe.fnName || 'function'
        debug('\nExecuting %s[%d]: [%s]\n\t[deps expect]: %s\n\t[deps actual]: %s\n\t[sups expect]: %s'
          , name, idx, fnName,
          formatArguments(pipe.deps).join(', '),
          args.join(', '),
          formatArguments(pipe.supplies).join(', '))
        return true
      },
      deps: pipe.deps
    }

    var afterPipe = {
      fn: function() {
        var args = formatArguments(arguments)
        var fnName = pipe.fnName || 'function'
        debug('\nFinishing %s[%d]: [%s]\n\t[sups actual]: %s'
          , name, idx, fnName, args.join(', '))
        return true
      },
      deps: pipe.supplies
    }

    _pipes.push(beforePipe)
    _pipes.push(pipe)
    _pipes.push(afterPipe)

  })

  return _pipes
}

function formatArguments(args) {
  var _args = toArray(args)
  foreach(_args, function(arg, idx) {
    var type = typeof arg
    if ('string' === type) {
      _args[idx] = '"' + arg + '"'
    } else if ('function' === type) {
      _args[idx] = '[Function' + (arg.name ? ': ' + arg.name : '') + ']'
    } else if (null === arg) {
      _args[idx] = 'null'
    } else if ('undefined' === type) {
      _args[idx] = 'undefined'
    }
  })
  return _args
}

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

function checkFulfillment(propName, state, supplies, fulfilled) {
  if (propName === ERROR_NAME) {
    state.hasError = true
  } else if (-1 === indexOf(supplies, propName))
    throw new Error('Dependency "' + propName + '" is not defined in supplies.')
  if (fulfilled && -1 === indexOf(fulfilled, propName))
    fulfilled.push(propName)
}
