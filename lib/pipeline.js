'use strict'

var Injector = require('insider')
var toArray = require('lodash.toarray')
var isObject = require('lodash.isobject')
var isArray = require('lodash.isarray')
var EventEmitter = require('eventemitter3')

module.exports = Pipeline

function Pipeline(superpipe) {
  this.superpipe = superpipe
  this.injector = superpipe.injector
  this.pipes = []
  this.emitter = new EventEmitter()
}

Pipeline.prototype = {

  trigger: function() {
    this.emitter.emit.apply(this.emitter, arguments)
    return this
  },

  toTrigger: function(event) {
    var self = this
    return function trigger() {
      var args = toArray(arguments)
      args.unshift(event)
      self.trigger.apply(self, args)
    }
  },

  listenTo: function(emitter, name) {
    if ('string' === typeof emitter) {
      name = emitter
      emitter = this.emitter
    }
    var listenFn = emitter.on || emitter.addEventListener || emitter.addListener
    if ('function' !== typeof listenFn) {
      throw new Error('emitter has no listening funciton "on, addEventListener or addListener"')
    }
    listenFn = listenFn.bind(emitter)

    var self = this
    var pipes = this.pipes
    var superpipe = this.superpipe

    listenFn(name, function() {
      if (pipes[0]) {
        var step = 0
        var args = toArray(arguments)
        var injector = new Injector(self.injector)

        var setDep = superpipe.setDep.bind({
          injector: injector
        })

        // global deps setter for sharing states cross pipelines
        injector.regDependency('set', function() {
          superpipe.setDep.apply(superpipe, arguments)
          setDep.apply(null, arguments)
        })

        // local deps setter unique for each event
        injector.regDependency('setDep', setDep)

        var next = function next(err) {
          var pipe

          if (err) {
            if (self.errorHandler) {
              // error handler fn as a pipe
              pipe = self.errorHandler
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
              fn.fn._fn = injector.getDependency(fn.fnName)
            }
            //  run the actual function
            var result = fn.apply(injector, args)
              // check if we need to run next automatically
            if (!err && result !== false && (!deps || (deps.indexOf('next') === -1))) {
              // no deps or has deps but next is not required
              // call next pipe when the returned value is not false
              next()
            }
          }
        }

        // register all member of context as dependencies for this stream instance
        injector.regDependency('next', next)
          // start executing the chain
        next()
      }
    })

    return this
  },

  buildPipe: function(fn, deps) {
    var injector = this.injector
    var fnName
    if ('string' === typeof fn) {
      fnName = fn
      fn = function fn() {
        var _fn = fn._fn
        if ('function' === typeof _fn) {
          // @todo @note should test and catch bug like this
          // when it's a function call it with rest of the arguments
          return _fn.apply(this, toArray(arguments))
        } else if ('boolean' === typeof _fn) {
          // directly return the value when it is a boolean for flow control
          return _fn
        } else {
          throw new Error('Dependency ' + fnName + ' is not a function or boolean.')
        }
      }
    } else if ('number' === typeof fn) {
      // generate a throttle function
      var delay = fn
      var timestamp
      fn = function() {
        var now = new Date()
        if (!timestamp || now - timestamp > delay) {
          timestamp = new Date()
          return true
        } else {
          return false
        }
      }
    }

    if (isArray(fn)) {
      deps = fn.slice(1)
      fn = fn[0]
    }

    if ('function' !== typeof fn) {
      throw new Error('fn should be a function or name of registered function dependency: ' + fn)
    }

    // normalize deps to array
    if (arguments.length > 2) {
      deps = Array.prototype.slice.call(arguments, 1)
    } else if ('string' === typeof deps || (!isArray(deps) && isObject(deps))) {
      deps = [deps]
    }

    if (deps && !isArray(deps)) {
      throw new Error('deps should be either string or array of dependency names')
    }

    // get our injected version of pipe function
    fn = injector.inject(fn, deps)

    // Set the original function name to the injected function for later dependency discovery
    if (fnName) {
      fn.fnName = fnName
    }

    // return injectable function with depedencies array
    return {
      fn: fn,
      deps: deps
    }
  },

  pipe: function(fn, deps) {
    // save to the pipes array as a pipes unit
    var pipe = this.buildPipe.apply(this, arguments)
    this.pipes.push(pipe)
    return this
  },

  error: function() {
    this.errorHandler = this.buildPipe.apply(this, arguments)
    return this
  }
}
