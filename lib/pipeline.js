'use strict'

/**
 * Module dependencies
 */
var bind = require('lodash.bind')
var slice = require('lodash.slice')
var assign = require('lodash.assign')
var foreach = require('lodash.foreach')
var indexOf = require('lodash.indexof')
var toArray = require('lodash.toarray')
var isArray = require('lodash.isarray')
var Injector = require('insider')
var isPlainObject = require('lodash.isplainobject')


/**
 * Pipeline constructor. Pipeline is the place where you define a series of
 * operations you need to do when certain things happened (events).
 *
 * @param  {SuperPipe} [superpipe]  Instance of SuperPipe.
 * @return {Pipeline}               Instance of Pipeline.
 */
var Pipeline = module.exports = function Pipeline(superpipe) {
  var pipeline = assign(function() {
    pipeline.toPipe()()
  }, Pipeline.prototype)

  pipeline.pipes = []
  pipeline.connect(superpipe)

  return pipeline
}

Pipeline.prototype.connect = function(superpipe) {
  if (superpipe && superpipe.instanceOfSuperPipe) {
    this.superpipe = superpipe
    this.injector = superpipe.injector
  } else if (superpipe && superpipe instanceof Injector) {
    this.injector = superpipe
  } else {
    this.injector = new Injector()
  }

  return this
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
  function listenTo(eventEmitter, eventName, pipeline) {
    var listenFn = eventEmitter.on || eventEmitter.addEventListener || eventEmitter.addListener
    if ('function' !== typeof listenFn) {
      throw new Error('emitter has no listening funciton "on, addEventListener or addListener"')
    }
    listenFn = bind(listenFn, eventEmitter)
    listenFn(eventName, Pipeline.toPipe(pipeline))
  }

  if ('string' === typeof emitter) {
    var superpipe = this.superpipe
    if (name) {
      // listenTo('nameOfEmitter', 'some event')
      var self = this
      var emitterName = emitter
      emitter = superpipe.getDep(emitterName)
      if (!emitter) {
        superpipe.onSetDep(emitterName, function(newEmitter, oldEmitter) {
          if (oldEmitter) {
            var removeAll = (oldEmitter.removeAllListeners || oldEmitter.off)
            removeAll && removeAll.call(oldEmitter, name)
          }
          listenTo(newEmitter, name, self)
        })
        return this
      }
    } else {
      // listenTo('some event')
      name = emitter
      emitter = superpipe
    }
  }

  listenTo(emitter, name, this)
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
    if ('emit' === fn) {
      // .pipe('emit', 'event name', ['event', 'object'])
      return this.emit(deps, supplies)
    } else {
      return this.dipe(fn, deps, supplies)
    }
  } else if (fn instanceof Pipeline) {
    fn = fn.toPipe()
  }

  // save to the pipes array as a pipes unit
  var pipe = this.buildPipe(fn, deps, supplies)
  this.push(pipe)
  return this
}

Pipeline.prototype.emit = function(eventName, deps) {
  var self = this
  var fn = function() {
    var args = toArray(arguments)
    args.unshift(eventName)
    var emit = self.injector.get('emit')
    emit.apply(null, args)
  }

  // Build the pipe.
  var pipe = this.buildPipe(fn, deps)
  this.push(pipe)

  return this
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
    } else if (true === pipe.optional && 'undefined' === typeof ofn) {
      // Optional pipe which pipe function can not be found.
      // Return true to ignore and go next.
      return true
    } else {
      throw new Error('Dependency ' + name + ' is not a function or boolean.')
    }
  }

  // Build the pipe.
  var pipe = this.buildPipe(fn, deps, supplies)

  if (/\?$/.test(name)) {
    // Optional pipe if function name ends with question mark.
    pipe.optional = true
    // Remove the trailing question mark.
    name = name.slice(0, name.length - 1)
  }

  // Set the original function name to the pipe object for later dependency discovery.
  pipe.fnName = name
  this.push(pipe)

  return this
}

Pipeline.prototype.throttle = function(msec) {
  // Generate a throttle function and push to pipes
  var timestamp
  this.push({
    fn: function throttleFn() {
      var now = new Date()
      if (!timestamp || now - timestamp > msec) {
        timestamp = new Date()
        return true
      } else {
        return false
      }
    }
  })

  return this
}

Pipeline.prototype.push = function(pipe) {
  if (this.sealed) {
    throw new Error('Pipeline line already sealed, no more pipe could be added.')
  }
  this.pipes.push(pipe)
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

  if (isArray(deps)) {
    var firstDep = deps[0]
    if ('number' === typeof firstDep && firstDep > 0) {
      deps[0] = null
      while (firstDep > 1) {
        deps.unshift(null)
        firstDep--
      }
    }
  }

  // get our injected version of pipe function
  var injectedFn = this.injector.inject(fn, deps)
  var fnName = injectedFn.name || fn.name

  // return injectable function with depedencies array
  return {
    fn: injectedFn,
    fnName: fnName,
    ofn: fn,
    deps: deps,
    supplies: supplies
  }
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

Pipeline.prototype.seal = function() {
  this.sealed = true
}

Pipeline.prototype.toPipe = function(begin, end) {
  return Pipeline.toPipe(this, slice(this.pipes, begin, end))
}

Pipeline.prototype.toCurriedPipe = function(begin, end) {
  var self = this
  return function(superpipe) {
    self.connect(superpipe)
    return self.toPipe(begin, end)
  }
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
  pipes = pipes || pipeline.pipes
  superpipe = superpipe || pipeline.superpipe

  return function() {
    if (pipes[0]) {
      var step = 0
      var args = toArray(arguments)
      var injector = new Injector(pipeline.injector)

      var setDep = bind(superpipe.setDep, {
        injector: injector
      })

      if (superpipe) {
        // Global dependencies setter for sharing states cross pipelines.
        injector.set('set', function() {
          superpipe.setDep.apply(superpipe, arguments)
          setDep.apply(null, arguments)
        })
      }

      // local deps setter unique for each pipeline
      injector.set('setDep', setDep)

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
            var ex = new Error()
            ex.name = 'Pipeline has no error handler function.'
            ex.message = JSON.stringify(err)
            throw ex
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
          var fnReturned = false
          var supplies = pipe.supplies
          // No deps or has deps but next is not required as dependency.
          var autoNext = !deps || (indexOf(deps, 'next') === -1)

          // Get the pipe function demanded from dependency container.
          if ('string' === typeof fnName) {
            // Set it as the original pipe function
            pipe.ofn = injector.get(fnName)
          }

          if (pipe.optional) {
            // Optional pipe, go next if we can't get all dependencies.
            var _deps = injector.getAll(deps)
            if (_deps.indexOf(undefined) > -1) {
              next()
              return
            }
          }

          var modifiedSetDep
          var modifySetDep = supplies && supplies.length > 0
          if (modifySetDep) {
            // Modify the `setDep`
            // Only track dependencies when autoNext is true.
            var fulfilled = autoNext && []
            // We will handle the auto next behaviour.
            autoNext = false

            modifiedSetDep = function(name, dep, props) {
              var normalized = superpipe.normalizeSetDepArgs(name, dep, props)
              var _props = normalized.props || (normalized.name ? [normalized.name] : [])

              // Whether dependency being injected is defined in `supplies`.
              foreach(_props, function(propName) {
                if (-1 === indexOf(supplies, propName)) {
                  throw new Error('Dependency "' + propName + '" is not defined in supplies.')
                }
                if (fulfilled && -1 === indexOf(fulfilled, propName)) {
                  fulfilled.push(propName)
                }
                return true
              })

              // Set the dependencies.
              setDep(name, dep, props)

              if (fulfilled && fulfilled.length === supplies.length) {
                // Set the auto next to true or call next when all required
                // supplies are fulfilled.
                if (fnReturned && ('undefined' === typeof result || false !== result)) {
                  // Function has been returned.
                  // We should call next when the returned value is either
                  // undefined or not false.
                  injector.set('setDep', setDep)
                  next()
                } else {
                  // Otherwise, let the code below to handle when to call next.
                  autoNext = true
                }
              } else if (fulfilled && fulfilled.length > supplies.length) {
                throw new Error('Got more dependencies than what supplies required.')
              }
            }

            injector.set('setDep', modifiedSetDep)
          }

          // Run the actual function
          try {
            result = fn.apply(injector, args)
            fnReturned = true
          } catch (e) {
            next(e)
            return
          }

          // Call setDep if a plain object was returned
          if (isPlainObject(result)) {
            (modifiedSetDep || setDep)(result)
          }

          // Ensure to put back the original `setDep` function if modified.
          if (modifySetDep) {
            injector.set('setDep', setDep)
          }

          // Check if we need to run next automatically when:
          // 1. result is true
          // 2. autoNext is true and no error and result is not false
          if (true === result || (autoNext && !err && false !== result)) {
            next()
          }
        }
      }

      // register `next` function as dependency
      injector.set('next', next)
      // start executing the chain
      next()
    }
  }
}
