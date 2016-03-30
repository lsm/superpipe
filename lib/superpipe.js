'use strict'

/**
 * Module dependencies
 */
var DEP = require('./dep')
var bind = require('lodash.bind')
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
  if (this instanceof SuperPipe) {
    this.instanceOfSuperPipe = true
    this.injector = injector || new Injector()

    // bind selected functions to current context
    var fns = ['autoBind', 'emit']
    for (var i = 0; i < 3; i++) {
      var prop = fns[i]
      if ('function' === typeof this[prop]) {
        this[prop] = bind(this[prop], this)
        this.injector.set(prop, this[prop])
      }
    }
  } else {
    return SuperPipe.pipeline()
  }
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
 * @param  {EventEmitter} [emitter]   An instance of EventEmitter.
 * @param  {String} eventName         Name of the event to listen.
 * @return {Pipeline}                 A newly created Pipeline instance.
 */
SuperPipe.prototype.listenTo = function(emitter, eventName) {
  if (1 === arguments.length) {
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

SuperPipe.pipeline = function() {
  return new Pipeline()
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
  if (undefined === autoBind)
    return this._autoBind

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
  return DEP.isDepNameReserved(DEP.RESERVED_DEPS, name)
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
  DEP.setDep(this, this.injector, name, dep, props)
  return this
}

SuperPipe.prototype.onSetDep = function(depName, callback) {
  var eventName = DEP.CHANGE_EVENT_PREFIX + depName
  this.on(eventName, callback)
}

/**
 * Get a dependency from the superpipe
 * @param  {[type]} name [description]
 * @return {[type]}      [description]
 */
SuperPipe.prototype.getDep = function(name) {
  return this.injector.get(name)
}
