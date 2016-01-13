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
  var superpipe = this.superpipe
  var listen = function listen(eventEmitter, eventName, pipeline) {
    var listenFn = eventEmitter.on || eventEmitter.addEventListener || eventEmitter.addListener
    if ('function' !== typeof listenFn) {
      throw new Error('emitter has no listening funciton "on, addEventListener or addListener"')
    }
    listenFn = bind(listenFn, eventEmitter)
    listenFn(eventName, Pipeline.toPipe(pipeline, pipeline.pipes, pipeline.superpipe))
  }

  if ('string' === typeof emitter) {
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
          listen(newEmitter, name, self)
        })
        return this
      }
    } else {
      // listenTo('some event')
      name = emitter
      emitter = superpipe
    }
  }

  listen(emitter, name, this)
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
  this.pipes.push(pipe)
  return this
}

Pipeline.prototype.emit = function(eventName, deps) {
  var emit = this.injector.get('emit')
  var fn = function() {
    var args = toArray(arguments)
    args.unshift(eventName)
    emit.apply(null, args)
  }

  // Build the pipe.
  var pipe = this.buildPipe(fn, deps)
  // Set the original function name to the pipe object for later dependency discovery.
  this.pipes.push(pipe)

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

  // return injectable function with depedencies array
  return {
    fn: injectedFn,
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

Pipeline.prototype.toPipe = function(begin, end) {
  return Pipeline.toPipe(this, slice(this.pipes, begin, end), this.superpipe)
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
      injector.set('set', function() {
        superpipe.setDep.apply(superpipe, arguments)
        setDep.apply(null, arguments)
      })

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
            pipe.ofn = injector.get(fnName)
          }

          var modifySetDep = supplies && supplies.length > 0
          if (modifySetDep) {
            // Modify the `setDep`
            var fulfilled = autoNext && []
            // We will handle the auto next behaviour.
            autoNext = false

            var inSupplies
            injector.set('setDep', function(name, dep, props) {
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
            injector.set('setDep', setDep)
          }

          // check if we need to run next automatically
          if (autoNext && !err && result !== false) {
            // call next pipe when the returned value is not false
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
