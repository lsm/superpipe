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
var setDepWithState = require('./dep').setDepWithState


var executePipe = exports.executePipe = function(err, args, nextArgs, state, injector) {
  var pipe = state.pipe
  var fn = pipe.fn
  var deps = pipe.deps
  var next = state.next
  var fnName = pipe.fnName
  var setDep = state.setDep
  var supplies = pipe.supplies

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
    injector.set('set', modifiedSetDep)
  }

  // Run the actual function
  var _args = injector.getAll(deps, args)
  // Ensure to put back the original `setDep` function if modified.
  if (modifiedSetDep)
    injector.set('set', setDep)

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

exports.toPipe = function(pipeline, pipelineName) {
  var pipes = pipeline.getPipes()
  var _injector = pipeline.getInjector()

  var debug = pipeline.debug()
  if (debug)
    pipes = addDebugPipes(pipes, pipelineName, 'function' === typeof debug ? debug : null)

  return function() {
    if (pipes[0]) {
      var step = 0
      var args = toArray(arguments)
      var injector = new Injector(_injector)

      var setDep = function(name, dep, props) {
        DEP.setDep(injector, name, dep, props)
      }

      // local deps setter unique for each pipeline
      injector.set('set', setDep)

      if (_injector) {
        // Global dependencies setter for sharing states cross pipelines.
        injector.set('setGlobal', function(name, dep, props) {
          DEP.setDep(_injector, name, dep, props)
          setDep(name, dep, props)
        })
      }

      var previousState
      var next = function next(err, name, dep, props) {
        if (previousState && arguments.length > 1) {
          previousState.autoNext = false
          setDepWithState(previousState, name, dep, props)
        }

        // Should execute error pipe when `error` could be found in injector.
        if (err)
          injector.set('error', err)
        else
          err = injector.get('error')

        var pipe
        if (err) {
          // Assign the err object to the first argument
          // so the error handler can get the error later
          args[0] = err
          pipe = getErrorPipe(err, pipeline, pipes, step, injector)
        } else {
          // get the right unit from the pipes array
          pipe = pipes[step++]
        }
        if (pipe) {
          var deps = pipe.deps
          var state = {
            pipe: pipe,
            next: next,
            setDep: setDep,
            result: undefined,
            supplies: pipe.supplies,
            // No deps or has deps but next is not required as dependency.
            autoNext: !deps || -1 === indexOf(deps, 'next'),
            setDepMap: pipe.setDepMap,
            fnReturned: false
          }
          previousState = state
          executePipe(err, args, arguments, state, injector)
        }
      }

      // Register `next` function as dependency
      injector.set('next', next)
      // Start executing the chain
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
    if ('string' === type)
      _args[idx] = '"' + arg + '"'
    else if ('function' === type)
      _args[idx] = '[Function' + (arg.name ? ': ' + arg.name : '') + ']'
    else if (null === arg)
      _args[idx] = 'null'
    else if ('undefined' === type)
      _args[idx] = 'undefined'
  })
  return _args
}

function getErrorPipe(error, pipeline, pipes, step, injector) {
  if (pipeline.errorHandler) {
    // error handler fn as a pipe
    var pipe = pipeline.errorHandler
    var previousPipe = pipes[step - 1]
    if (previousPipe && previousPipe.fnName)
      injector.set('errPipeName', previousPipe.fnName)
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
