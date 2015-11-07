'use strict'

/**
 * Module dependencies
 */
var bind = require('lodash.bind')
var slice = require('lodash.slice')
var indexOf = require('lodash.indexof')
var Injector = require('insider')
var toArray = require('lodash.toarray')
var isObject = require('lodash.isobject')
var isArray = require('lodash.isarray')


/**
 * Pipeline constructor. Pipeline is the place where you define a series of
 * operations you need to do when certain things happened (events).
 *
 * @param  {SuperPipe} superpipe  Instance of SuperPipe.
 * @return {Pipeline}             Instance of Pipeline.
 */
var Pipeline = module.exports = function Pipeline(superpipe) {
  this.superpipe = superpipe
  this.injector = superpipe.injector
  this.pipes = []
}

/**
 * Listen to a event emits from the emitter.
 *
 * @param  {EventEmitter} [emitter] The emitter to listen events from.
 * The superpipe instance will be used as emitter if only event name is provided.
 * @param  {String}       name      Name of the event to listen.
 * @return {Pipeline}               Instance of this Pipeline.
 */
Pipeline.prototype.listenTo = function(emitter, name) {
  if ('string' === typeof emitter) {
    name = emitter
    emitter = this.superpipe
  }
  var listenFn = emitter.on || emitter.addEventListener || emitter.addListener
  if ('function' !== typeof listenFn) {
    throw new Error('emitter has no listening funciton "on, addEventListener or addListener"')
  }

  listenFn = bind(listenFn, emitter)
  listenFn(name, Pipeline.toPipe(this, this.pipes, this.superpipe))

  return this
}

/**
 * Put function and its dependencies to the pipeline.
 *
 * @param  {Function|String|Number|Array} fn
 *         - Function: The pipe function
 *         - String: Name of function which could be found in dependencies.
 *         - Number: Number of miliseconds to throttle the pipeline.
 *         - Array: A array which contains both `fn` (first) and `deps` (rest).
 * @param  {Array|String}   ...deps String or array of names of dependencies.
 * @return {Pipeline}       Instance of this Pipeline.
 */
Pipeline.prototype.pipe = function(fn, deps) {
  var type = typeof fn
  if ('number' === typeof fn) {
    return this.throttle(fn)
  } else if ('string' === type) {
    return this.dipe.apply(this, toArray(arguments))
  }
  // save to the pipes array as a pipes unit
  var pipe = this.buildPipe.apply(this, toArray(arguments))
  this.pipes.push(pipe)
  return this
}

/**
 * The actual function for building a pipe.
 *
 * @param  {Function} fn
 *         - Function: The pipe function
 *         - String: Name of function which could be found in dependencies.
 *         - Number: Number of miliseconds to throttle the pipeline.
 *         - Array: A array which contains both `fn` (first) and `deps` (rest).
 * @param  {Array|String}   deps... String or array of names of dependencies.
 * @return {Object}         An object contains dependencies injected function and deps.
 */
Pipeline.prototype.buildPipe = function(fn, deps) {
  if ('function' !== typeof fn) {
    throw new Error('fn should be a function, got ' + typeof fn)
  }

  if ('string' === typeof deps) {
    deps = [deps]
  }

  if (deps && !isArray(deps)) {
    throw new Error('deps should be either string or array of dependency names')
  }

  // get our injected version of pipe function
  fn = this.injector.inject(fn, deps)

  // return injectable function with depedencies array
  return {
    fn: fn,
    deps: deps
  }
}

Pipeline.prototype.dipe = function(name, deps, supplies) {
  var injectedFn

  var fn = function() {
    var _fn = injectedFn.ofn && injectedFn.ofn._fn
    if ('function' === typeof _fn) {
      // @todo @note should test and catch bug like this
      // when it's a function call it with rest of the arguments
      return _fn.apply(this, toArray(arguments))
    } else if ('boolean' === typeof _fn) {
      // directly return the value when it is a boolean for flow control
      return _fn
    } else {
      throw new Error('Dependency ' + name + ' is not a function or boolean.')
    }
  }

  var args = toArray(arguments)
  args[0] = fn

  // Build the pipe.
  var pipe = this.buildPipe.apply(this, args)
  injectedFn = pipe.fn
  // Set the original function name to the injected function for later dependency discovery.
  injectedFn.fnName = name
  this.pipes.push(pipe)

  return this
}

Pipeline.prototype.throttle = function(num) {
  // generate a throttle function and push to pipes
  var timestamp
  this.pipes.push({
    fn: function throttleFn() {
      var now = new Date()
      if (!timestamp || now - timestamp > num) {
        timestamp = new Date()
        return true
      } else {
        return false
      }
    }
  })

  return this
}

Pipeline.prototype.slice = function(begin, end) {
  var pipeline = new Pipeline(this.superpipe)
  pipeline.pipes = this.pipes.slice(begin, end)

  return pipeline
}

Pipeline.prototype.concat = function(pipeline, begin, end) {
  var _pipeline = this.slice(begin, end)
  _pipeline.pipes = _pipeline.pipes.concat(pipeline.pipes)

  return _pipeline
}

Pipeline.prototype.toPipe = function(begin, end) {
  return Pipeline.toPipe(this, this.pipes.slice(begin, end), this.superpipe)
}

/**
 * Set the error handler for this pipeline.
 *
 * @param  {Function|String|Array} fn
 *         - Function: The pipe function
 *         - String: Name of function which could be found in dependencies.
 *         - Array: A array which contains both `fn` (first) and `deps` (rest).
 * @param  {Array|String}   deps... String or array of names of dependencies.
 * @return {Pipeline}       Instance of this Pipeline.
 */
Pipeline.prototype.error = function(fn, deps) {
  if ('number' === typeof fn) {
    throw new Error('Error handler does not accept number as argument.')
  }
  this.errorHandler = this.buildPipe.apply(this, arguments)
  return this
}

Pipeline.toPipe = function(pipeline, pipes, superpipe) {
  return function() {
    if (pipes[0]) {
      var step = 0
      var args = toArray(arguments)
      var injector = new Injector(pipeline.injector)

      var setDep = bind(superpipe.setDep, {
        injector: injector
      })

      // global deps setter for sharing states cross pipelines
      injector.regDependency('set', function() {
        superpipe.setDep.apply(superpipe, arguments)
        setDep.apply(null, arguments)
      })

      // local deps setter unique for each pipeline
      injector.regDependency('setDep', setDep)

      var next = function(err) {
        var pipe
        if (err) {
          if (pipeline.errorHandler) {
            // error handler fn as a pipe
            pipe = pipeline.errorHandler
            // assign the err object to the first argument
            // so the error handler can get the error later
            args[0] = err
          } else {
            console.warn('No error handler function')
            console.error(err)
          }
        } else {
          // get the right unit from the pipes array
          pipe = pipes[step++]
        }

        if (pipe) {
          var fn = pipe.fn
          var deps = pipe.deps
          if ('string' === typeof fn.fnName) {
            fn.ofn._fn = injector.getDependency(fn.fnName)
          }
          //  run the actual function
          var result = fn.apply(injector, args)

          // check if we need to run next automatically
          if (!err && result !== false && (!deps || (indexOf(deps, 'next') === -1))) {
            // no deps or has deps but next is not required as dependency
            // call next pipe when the returned value is not false
            next()
          }
        }
      }
      // register `next` function as dependency
      injector.regDependency('next', next)
      // start executing the chain
      next()
    }
  }
}
