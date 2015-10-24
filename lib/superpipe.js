'use strict'

/**
 * Module dependencies
 */
var keys = Object.keys || require('object-keys');
var Injector = require('insider')
var Pipeline = require('./pipeline')
var assign = require('lodash.assign')
var EventEmitter = require('eventemitter3')

/**
 * The SuperPipe constructor. It has 3 roles:
 *   1. Maintain global dependencies which can be shared cross pipelines.
 *   2. Maintain a global event emitter which can be used to trigger/listen events cross pipelines.
 *   3. Provides the dependency injection feature to pipeline.
 *
 * @type {Function}
 * @return {SuperPipe} Instance of SuperPipe
 */
var SuperPipe = module.exports = function SuperPipe(injector) {
  this.injector = injector || new Injector()
  this.reservedDeps = ['on', 'autoBind', 'emit',
    'setDep', 'getDep', 'set', 'get',
    'next', 'pipe', 'pipeline'
  ];

  // bind selected functions to current context
  ['autoBind', 'isDepNameReserved', 'emit'].forEach(function(prop) {
    if ('function' === typeof this[prop]) {
      this[prop] = this[prop].bind(this)
      this.injector.regDependency(prop, this[prop])
    }
  }, this)
}

/**
 * Expose Injector and Pipeline
 */
SuperPipe.Injector = Injector
SuperPipe.Pipeline = Pipeline

/**
 * Inherits from EventEmitter
 */
assign(SuperPipe.prototype, EventEmitter.prototype)

/**
 * Listen to the event of emitter and create a new pipeline to handle the emitted events.
 * Use the current superpipe instance as the emitter if only one argument is provided.
 *
 * @param  {EventEmitter} [emitter]   A instance of EventEmitter.
 * @param  {String} eventName         Name of the event to listen.
 * @return {Pipeline}                 A newly created Pipeline instance.
 */
SuperPipe.prototype.listenTo = function(emitter, eventName) {
  if (arguments.length === 1) {
    eventName = emitter
    emitter = this
  }
  var pl = this.pipeline()
  return pl.listenTo.call(pl, emitter, eventName)
}

/**
 * Create a new Pipeline instance.
 * @return {Pipeline} A newly created Pipeline instance.
 */
SuperPipe.prototype.pipeline = function() {
  return new Pipeline(this)
}

/**
 * `autoBind` controls if we should automatically bind the function dependency
 *   to its original context (if there's any).
 *
 * @param  {Boolean|undefined} [autoBind] Use `true` or `false` to change the value,
 *                                        `undefined` to get the current value.
 * @return {SuperPipe}                    Instance of SuperPipe
 */
SuperPipe.prototype.autoBind = function(autoBind) {
  if (undefined === autoBind) {
    return this._autoBind
  }
  this._autoBind = autoBind
  return this
}

/**
 * Detect if the name of the dependency is reserved.
 *
 * @param  {String}  name Name of the dependency.
 * @throw {Exception}     Throw exception if the name is reserved.
 * @return {Boolean}      Returns fasle if the name is not reserved.
 */
SuperPipe.prototype.isDepNameReserved = function(name) {
  if ('string' === typeof name && this.reservedDeps.indexOf(name) > -1) {
    throw new Error('The name of your dependency is reserved: ' + name)
  } else if (Array.isArray(name)) {
    this.reservedDeps.forEach(function(reserved) {
      if (name.indexOf(reserved) > -1) {
        throw new Error('The name of your dependency is reserved: ' + reserved)
      }
    })
  }
  return false
}

/**
 * Set dependencies to the superpipe.
 *
 * @param {String}        [name]  Name of the dependency to set.
 *                                Or prefix when `props` is presented.
 * @param {Object}           dep     The dependency object.
 * @param {String|Array}  [props] Name(s) of properties to set as dependencies or shortcuts.
 *                                '*': set all the properties of the object as dependencies.
 *                                '*^' set all the function properties of the object as dependencies.
 *                                '*$' set all non-function properties of the object as dependencies.
 */
SuperPipe.prototype.setDep = function(name, dep, props) {
  if ('string' !== typeof name) {
    props = dep
    dep = name
    name = null
  }

  if (!name && (!dep || 'object' !== typeof dep)) {
    throw new Error('Unsupported function arguments')
  }

  props = normalizeProps(name, dep, props)

  var injector = this.injector
  var autoBind = injector.getDependency('autoBind')()
  // check if any name of dependency is reserved
  var isDepNameReserved = injector.getDependency('isDepNameReserved')
  if (name) {
    isDepNameReserved(name)
  } else {
    props = props ? props : keys(dep)
    isDepNameReserved(props)
  }

  if (!props) {
    if (name) {
      // setDep(name, value)
      injector.regDependency(name, dep)
    } else if ('object' === typeof dep) {
      // setDep(depObject)
      injector.regDependency(dep)
    }
  } else if ('object' === typeof dep) {
    props.forEach(function(prop) {
      var p = name ? [name, prop].join(':') : prop
      var depObject = dep[prop]
      if (autoBind && 'function' === typeof depObject) {
        depObject = depObject.bind(dep)
      }
      injector.regDependency(p, depObject)
    })
  } else {
    throw new Error('Unsupported function arguments')
  }

  return this
}

/**
 * Get a dependency from the superpipe
 * @param  {[type]} name [description]
 * @return {[type]}      [description]
 */
SuperPipe.prototype.getDep = function(name) {
  return this.injector.getDependency(name)
}

/**
 * Private functions
 */

function normalizeProps(name, dep, props) {
  if ('string' === typeof props && 'object' === typeof dep) {
    var allKeys = keys(dep)
    var protoKeys = keys(Object.getPrototypeOf(dep))
    if (protoKeys.length > 0) {
      for (var i = 0, l = protoKeys.length; i < l; i++) {
        allKeys.push(protoKeys[i])
      }
    }
    if (props) {
      switch (props) {
        case '*':
          props = allKeys.filter(function(prop) {
            return '_' !== prop[0]
          })
          break
        case '*^':
          props = allKeys.filter(function(prop) {
            return '_' !== prop[0] && 'function' === typeof dep[prop]
          })
          break
        case '*$':
          props = allKeys.filter(function(prop) {
            return '_' !== prop[0] && 'function' !== typeof dep[prop]
          })
          break
        default:
          props = [props]
      }
    } else if (!name) {
      props = allKeys
    }
  }
  return props
}
