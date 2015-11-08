'use strict'

/**
 * Module dependencies
 */
var bind = require('lodash.bind')
var every = require('lodash.every')
var slice = require('lodash.slice')
var indexOf = require('lodash.indexof')
var Injector = require('insider')
var toArray = require('lodash.toarray')
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
Pipeline.prototype.pipe = function(fn, deps, supplies) {
  var type = typeof fn

  if ('number' === typeof fn) {
    return this.throttle(fn)
  } else if ('string' === type) {
    return this.dipe(fn, deps, supplies)
  } else if (fn instanceof Pipeline) {
    fn = fn.toPipe()
  }

  // save to the pipes array as a pipes unit
  var pipe = this.buildPipe(fn, deps, supplies)
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
Pipeline.prototype.buildPipe = function(fn, deps, supplies) {
  if ('function' !== typeof fn) {
    throw new Error('fn should be a function, got ' + typeof fn)
  }

  if ('string' === typeof deps) {
    deps = [deps]
  }

  if ('string' === typeof supplies) {
    supplies = [supplies]
  }

  if (deps && !isArray(deps)) {
    throw new Error('deps should be either string or array of dependency names')
  }

  if (supplies && !isArray(supplies)) {
    throw new Error('deps should be either string or array of dependency names')
  }

  // get our injected version of pipe function
  var injectedFn = this.injector.inject(fn, deps)

  // return injectable function with depedencies array
  return {
    fn: injectedFn,
    ofn: fn,
    deps: deps,
    supplies: supplies
  }
}

Pipeline.prototype.dipe = function(name, deps, supplies) {
  var fn = function() {
    var ofn = pipe.ofn
    if ('function' === typeof ofn) {
      // when it's a function call it with rest of the arguments
      return ofn.apply(this, toArray(arguments))
    } else if ('boolean' === typeof ofn) {
      // directly return the value when it is a boolean for flow control
      return ofn
    } else {
      throw new Error('Dependency ' + name + ' is not a function or boolean.')
    }
  }

  // Build the pipe.
  var pipe = this.buildPipe(fn, deps, supplies)
  // Set the original function name to the pipe object for later dependency discovery.
  pipe.fnName = name
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
  var sliced = new Pipeline(this.superpipe)
  sliced.pipes = slice(this.pipes, begin, end)

  return sliced
}

Pipeline.prototype.concat = function(pipeline, begin, end) {
  var concated = this.slice()
  concated.pipes = concated.pipes.concat(slice(pipeline.pipes, begin, end))

  return concated
}

Pipeline.prototype.toPipe = function(begin, end) {
  return Pipeline.toPipe(this, this.pipes.slice(begin, end), this.superpipe)
}

/**
 * Set the error handler for this pipeline.
 *
 * @param  {Function|String} fn
 *         - Function: The pipe function
 *         - String: Name of function which could be found in dependencies.
 * @param  {Array|String}   deps... String or array of names of dependencies.
 * @return {Pipeline}       Instance of this Pipeline.
 */
Pipeline.prototype.error = function(fn, deps) {
  if ('number' === typeof fn) {
    throw new Error('Error handler does not accept numeric argument.')
  }
  this.errorHandler = this.pipe(fn, deps).pipes.pop()
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
          var fnName = pipe.fnName
          var result
          var resultReturned = false
          var supplies = pipe.supplies
          // No deps or has deps but next is not required as dependency.
          var autoNext = !deps || (indexOf(deps, 'next') === -1)

          // Get the pipe function demanded from dependency container.
          if ('string' === typeof fnName) {
            // Set it as the original pipe function
            pipe.ofn = injector.getDependency(fnName)
          }

          var modifySetDep = supplies && supplies.length > 0
          if (modifySetDep) {
            // Modify the `setDep`
            var fulfilled = autoNext && []
            // We will handle the auto next behaviour.
            autoNext = false

            var inSupplies
            injector.regDependency('setDep', function(name, dep, props) {
              var normalized = superpipe.normalizeSetDepArgs(name, dep, props)
              var _props = normalized.props || (normalized.name ? [normalized.name] : [])

              // Whether dependency being injected is defined in `supplies`.
              inSupplies = every(_props, function(propName) {
                if (-1 === indexOf(supplies, propName)) {
                  next('Dependency "' + propName + '" is not defined in supplies.')
                  return false
                }
                if (fulfilled && -1 === indexOf(fulfilled, propName)) {
                  fulfilled.push(propName)
                }
                return true
              })

              if (!inSupplies) {
                return
              }

              // Set the dependencies.
              setDep(name, dep, props)

              if (fulfilled && fulfilled.length === supplies.length) {
                // Set the auto next to true or call next when all required
                // supplies are fulfilled.
                if ('undefined' === typeof result) {
                  // Result is undefined:
                  if (resultReturned) {
                    // The undefined value has been returned by function.
                    // Call next.
                    next()
                  } else {
                    // Function has not been returned, set autoNext to true so
                    // the code below can handle the auto next.
                    autoNext = true
                  }
                } else if (false !== result) {
                  // Function has been returned (async) and it's not false.
                  // Go next.
                  next()
                }
              } else if (fulfilled && fulfilled.length > supplies.length) {
                next('Get more dependencies than what supplies required.')
              }
            })
          }

          // Run the actual function
          result = fn.apply(injector, args)
          resultReturned = true

          if (modifySetDep) {
            // Put back the original `setDep` function.
            injector.regDependency('setDep', setDep)
          }

          // check if we need to run next automatically
          if (autoNext && !err && result !== false) {
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
