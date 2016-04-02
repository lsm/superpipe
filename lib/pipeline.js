'use strict'

/**
 * Module dependencies
 */
var bind = require('lodash.bind')
var Pipe = require('./pipe')
var slice = require('lodash.slice')
var assign = require('lodash.assign')
var foreach = require('lodash.foreach')
var toArray = require('lodash.toarray')
var isArray = require('lodash.isarray')
var Injector = require('insider')


/**
 * Pipeline constructor. Pipeline is the place where you define a series of
 * operations you need to do when certain things happened (events).
 *
 * @param  {SuperPipe} [superpipe]  Instance of SuperPipe.
 * @return {Pipeline}               Instance of Pipeline.
 */
var Pipeline = module.exports = function Pipeline(superpipe) {
  var pipeline = assign(function(superpipe, name) {
    pipeline.toPipe(superpipe, name)()
  }, Pipeline.prototype)

  pipeline.pipes = []
  pipeline.connect(superpipe)

  return pipeline
}

/**
 * Static function which convert a pipeline to a pipe function
 * @type {Function}
 */
Pipeline.toPipe = Pipe.toPipe

/**
 * Connect a pipeline to a instance of Superpipe or Injector.
 * Then the pipeline will use that superpipe/inector as
 * its container of dependencies injection.
 *
 * @param  {Superpipe|Injector} superpipe [description]
 * @return {Pipeline}     Instance of Pipeline
 */
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
    if ('function' !== typeof listenFn)
      throw new Error('emitter has no listening funciton "on, addEventListener or addListener"')
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
    if ('emit' === fn)
      // .pipe('emit', 'event name', ['event', 'object'])
      return this.emit(deps, supplies)
    else
      return this.dipe(fn, deps, supplies)
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
  var pipe
  var fn = function() {
    var ofn = pipe.ofn
    if ('function' === typeof ofn) {
      // when it's a function call it with rest of the arguments
      var result = ofn.apply(this, toArray(arguments))
      if ('boolean' === typeof result)
        return pipe.not ? !result : result
      else
        return result
    } else if ('boolean' === typeof ofn) {
      // directly return the value when it is a boolean for flow control
      return pipe.not ? !ofn : ofn
    } else if (true === pipe.optional && 'undefined' === typeof ofn) {
      // Optional pipe which pipe function can not be found.
      // Return true to ignore and go next.
      return true
    } else {
      throw new Error('Dependency ' + name + ' is not a function or boolean.')
    }
  }

  // Build the pipe.
  pipe = this.buildPipe(fn, deps, supplies)

  if (/^!/.test(name)) {
    pipe.not = true
    name = name.slice(1)
  }

  if (/\?$/.test(name)) {
    // Optional pipe if function name ends with question mark.
    pipe.optional = true
    // Remove the trailing question mark.
    name = name.slice(0, name.length - 1)
  }

  // Set the original function name to the pipe object for later dependency discovery.
  pipe.fnName = name
  return this.push(pipe)
}

Pipeline.prototype.throttle = function(msec) {
  // Generate a throttle function and push to pipes
  var timestamp
  return this.push({
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
}

Pipeline.prototype.push = function(pipe) {
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
  if ('function' !== typeof fn)
    throw new Error('fn should be a function, got ' + typeof fn)

  var depsType = typeof deps
  if ('string' === depsType || 'number' === depsType)
    deps = [deps]

  if ('string' === typeof supplies)
    supplies = [supplies]

  if (deps && !isArray(deps))
    throw new Error('deps should be either string or array of dependency names if present')

  if (supplies && !isArray(supplies))
    throw new Error('supplies should be either string or array of dependency names if present')

  // If first dep is a number it tells us the number of original function
  // arguments we need to pass for calling the pipe function.
  if (deps) {
    var firstDep = deps[0]
    if ('number' === typeof firstDep && 0 < firstDep) {
      deps[0] = null
      while (1 < firstDep) {
        deps.unshift(null)
        firstDep--
      }
    }
  }

  // Detect any mapped supplies. Use the format `theOriginalName:theNewName` in
  // `supplies` array would cause the `setDep('theOriginalName', obj)` to actually
  // set the dependency equals calling `setDep('theNewName', obj)` hence mapped
  // the dependency name.
  var setDepMap
  foreach(supplies, function(supply) {
    if (/:/.test(supply)) {
      setDepMap = setDepMap || {}
      var mapping = supply.split(':')
      setDepMap[mapping[0]] = mapping[1]
    }
  })

  // Return pipe object with function and its metadata.
  return {
    fn: fn, // Original or wrapped function, should be never changed.
    ofn: fn, // The ofn property might be changed during pipeline execution for
    // loading/generating pipe functions dynamically.
    deps: deps,
    fnName: getFnName(fn),
    supplies: supplies,
    setDepMap: setDepMap
  }
}

Pipeline.prototype.slice = function(begin, end) {
  var sliced = new Pipeline(this.superpipe || this.injector)
  sliced.debug(this.debug())
  sliced.pipes = slice(this.pipes, begin, end)

  return sliced
}

Pipeline.prototype.clone = function(superpipe) {
  var cloned = this.slice()
  if (superpipe)
    cloned.connect(superpipe)
  return cloned
}

Pipeline.prototype.concat = function(pipeline, begin, end) {
  var concated = this.slice()
  concated.pipes = concated.pipes.concat(slice(pipeline.pipes, begin, end))

  return concated
}

Pipeline.prototype.toPipe = function(superpipe, name) {
  var pipeline = this.clone(superpipe)
  return Pipeline.toPipe(pipeline, slice(pipeline.pipes), name)
}

Pipeline.prototype.toCurriedPipe = function(name) {
  var self = this.slice()
  return function(superpipe) {
    if (superpipe)
      self.connect(superpipe)
    return self.toPipe(null, name)
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
  if ('number' === typeof fn)
    throw new Error('Error handler does not accept numeric argument.')
  this.errorHandler = this.pipe(fn, deps).pipes.pop()
  return this
}

Pipeline.prototype.debug = function(enable) {
  if ('undefined' === typeof enable)
    return this._debug
  this._debug = enable
}

function getFnName(fn) {
  var f = 'function' === typeof fn
  var s = f && ((fn.name && ['', fn.name]) || fn.toString().match(/function ([^\(]+)/))
  if (f)
    return s && s[1] || 'anonymous'
}
