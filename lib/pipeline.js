'use strict'

/**
 * Module dependencies
 */
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
var Pipeline = module.exports = function Pipeline(superpipe, pipes) {
  var pipeline = assign(function() {
    Pipe.toPipe(pipeline).apply(null, toArray(arguments))
  }, pipelineFunctions)

  var _pipes = isArray(pipes) ? slice(pipes) : []
  var injector

  /**
   * Pipeline reconstruction functions. Define them inline as we want to keep
   * `_pipes` private.
   */

  /**
   * Remove a pipe from the end of pipes and return it.
   */
  pipeline.pop = function() {
    return _pipes.pop()
  }

  /**
   * Push a pipe into pipeline
   * @param  {Object} pipe
   * @return {Pipeline}
   */
  pipeline.push = function(pipe) {
    _pipes.push(pipe)
    return this
  }

  pipeline.getPipes = function() {
    return slice(_pipes)
  }

  pipeline.getInjector = function() {
    return injector
  }

  pipeline.concat = function(pipeline) {
    var pipes = _pipes.concat(pipeline.getPipes())
    var concated = new Pipeline(injector, pipes)
    concated.debug(this.debug())
    concated.errorHandler = this.errorHandler
    return concated
  }

  /**
   * Create a new pipeline using a slice of the original pipeline
   * @param  {Number} [begin]
   * @param  {Number} [end]
   * @return {Pipeline}
   */
  pipeline.slice = function(begin, end) {
    var sliced = new Pipeline(injector, slice(_pipes, begin, end))
    sliced.debug(this.debug())
    sliced.errorHandler = this.errorHandler
    return sliced
  }

  /**
   * Connect a pipeline to a instance of Superpipe.
   * Then the pipeline will use that superpipe as
   * its container of dependencies injection.
   *
   * @param  {Superpipe} superpipe instance of superpipe
   * @return {Pipeline}     Instance of Pipeline
   */
  pipeline.connect = function(superpipe) {
    if (superpipe && true === superpipe.instanceOfSuperPipe)
      injector = superpipe.injector
    else if (superpipe && superpipe.getAll && superpipe.get && superpipe.set)
      injector = superpipe
    else
      injector = new Injector()
    return pipeline
  }

  // Connect pipeline with superpipe (share container of dependency injection)
  pipeline.connect(superpipe)

  return pipeline
}

/**
 * Static function which convert a pipeline to a pipe function
 * @type {Function}
 */
Pipeline.toPipe = Pipe.toPipe

/**
 * Pipeline instance functions
 */
var pipelineFunctions = {}

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
pipelineFunctions.pipe = function(fn, deps, supplies) {
  var type = typeof fn

  if ('number' === typeof fn) {
    return this.throttle(fn)
  } else if ('string' === type) {
    if ('emit' === fn)
      // .pipe('emit', 'event name', ['event', 'object'])
      return this.emit(deps, supplies)
    else
      return this.dipe(fn, deps, supplies)
  } else if (true === fn.instanceOfPipeline) {
    fn = fn.toPipe(this.getInjector())
  }

  // save to the pipes array as a pipes unit
  var pipe = buildPipe(fn, deps, supplies)
  this.push(pipe)
  return this
}

pipelineFunctions.emit = function(eventName, deps) {
  var self = this
  var fn = function() {
    var args = toArray(arguments)
    args.unshift(eventName)
    var emit = self.getInjector().get('emit')
    emit.apply(null, args)
  }

  // Build the pipe.
  var pipe = buildPipe(fn, deps)
  this.push(pipe)

  return this
}

pipelineFunctions.dipe = function(name, deps, supplies) {
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
      throw new Error('Dependency `' + name + '` is not a function.')
    }
  }

  // Build the pipe.
  pipe = buildPipe(fn, deps, supplies)

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

pipelineFunctions.throttle = function(msec) {
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

pipelineFunctions.wait = function(msec) {
  // Generate a wait function and push to pipes
  return this.push({
    fn: function waitFn(next) {
      setTimeout(next, msec)
    },
    deps: ['next']
  })
}

pipelineFunctions.clone = function(superpipe) {
  var cloned = this.slice()
  if (superpipe)
    cloned.connect(superpipe)
  return cloned
}

pipelineFunctions.toPipe = function(superpipe, name) {
  var cloned = this.clone(superpipe)
  return Pipeline.toPipe(cloned, name)
}

pipelineFunctions.toCurriedPipe = function(name) {
  var sliced = this.slice()
  return function(superpipe) {
    if (superpipe)
      sliced.connect(superpipe)
    return sliced.toPipe(null, name)
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
pipelineFunctions.error = function(fn, deps) {
  if ('number' === typeof fn)
    throw new Error('Error handler does not accept numeric argument.')
  this.errorHandler = this.pipe(fn, deps).pop()
  return this
}

pipelineFunctions.debug = function(enabled) {
  if ('undefined' === typeof enabled)
    return this._debug
  this._debug = enabled
  return this
}

/**
 * Private functions
 */

function getFnName(fn) {
  var f = 'function' === typeof fn
  var s = f && ((fn.name && ['', fn.name]) || fn.toString().match(/function ([^\(]+)/))
  if (f)
    return s && s[1] || 'anonymous'
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
function buildPipe(fn, deps, supplies) {
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
