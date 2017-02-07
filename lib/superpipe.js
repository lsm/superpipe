'use strict'

/**
 * Module dependencies
 */
var DEP = require('./dep')
var bind = require('lodash.bind')
var Injector = require('insider')
var Pipeline = require('./pipeline')


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
  // Create a new instance of superpipe
  var self = function(name) {
    if (arguments.length < 2) {
      var pipeline = new Pipeline(self)
      pipeline.Name(name)
      return pipeline
    }
  }
  // Create a default injector if not supplied
  injector = injector || new Injector()
  self.injector = injector
  // Instance functions & properties
  self.get = bind(injector.get, injector)
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
  self.set = bind(DEP.setDep, self, injector)
  self.autoBind = bind(autoBind, self)
  injector.set('autoBind', self.autoBind)
  // Automatically bind dependency function with their original context if
  // possible.
  self._autoBind = true
  self.instanceOfSuperPipe = true

  return self
}

/**
 * Expose Injector and Pipeline
 */
SuperPipe.Injector = Injector
SuperPipe.Pipeline = Pipeline

/**
 * Static function for creating new Pipeline instance.
 * 
 * @return {Pipeline} A newly created Pipeline instance.
 */

SuperPipe.pipeline = function() {
  return new Pipeline()
}

/**
 * `autoBind` controls if we should automatically bind the function dependency
 *   to its original context (if there's any).
 *
 * @param  {Boolean|undefined} [autoBind] Use `true` or `false` to change the value,
 *                                        `undefined` to get the current value.
 * @return {SuperPipe|Boolean}            Instance of SuperPipe or the boolean value.
 */
var autoBind = function(autoBind) {
  if ('undefined' === typeof autoBind)
    return this._autoBind

  this._autoBind = autoBind
  return this
}
