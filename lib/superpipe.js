'use strict'
/**
 * Module dependencies
 */

var Injector = require('insider')
var Pipeline = require('./pipeline')
var assign = require('lodash.assign')
var EventEmitter = require('eventemitter3')

/**
 * The plumber constructor. It can make pipelines and maintain shared dependencies
 * between pipelines.
 *
 * @type {Function}
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

SuperPipe.prototype = assign(EventEmitter.prototype, {
  listenTo: function(emitter, eventName) {
    var pl = this.pipeline()
    return pl.listenTo.apply(pl, arguments)
  },

  pipeline: function() {
    return new Pipeline(this)
  },

  autoBind: function(autoBind) {
    if (undefined === autoBind) {
      return this._autoBind
    }
    this._autoBind = autoBind
    return this
  },

  isDepNameReserved: function(name) {
    if ('string' === typeof name && this.reservedDeps.indexOf(name) > -1) {
      throw new Error('The name of your dependency is reserved: ' + name)
    } else if (Array.isArray(name)) {
      this.reservedDeps.forEach(function(reserved) {
        if (name.indexOf(reserved) > -1) {
          throw new Error('The name of your dependency is reserved: ' + reserved)
        }
      })
    }
  },

  setDep: function(name, dep, props) {
    if ('string' !== typeof name) {
      props = dep
      dep = name
      name = null
    }

    if (!name && (!dep || 'object' !== typeof dep)) {
      throw new Error('Unsupported function arguments')
    }

    if ('string' === typeof props && 'object' === typeof dep) {
      var keys = assign(Object.keys(dep), Object.keys(Object.getPrototypeOf(dep)))
      if (props) {
        switch (props) {
          case '*':
            props = keys.filter(function(prop) {
              return '_' !== prop[0]
            })
            break
          case '*^':
            props = keys.filter(function(prop) {
              return '_' !== prop[0] && 'function' === typeof dep[prop]
            })
            break
          case '*$':
            props = keys.filter(function(prop) {
              return '_' !== prop[0] && 'function' !== typeof dep[prop]
            })
            break
          default:
            props = [props]
        }
      } else if (!name) {
        props = keys
      }
    }


    var injector = this.injector
    var autoBind = injector.getDependency('autoBind')()
      // check if any name of dependency is reserved
    var isDepNameReserved = injector.getDependency('isDepNameReserved')
    if (name) {
      isDepNameReserved(name)
    } else {
      props = props ? props : Object.keys(dep)
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
  },

  getDep: function(name) {
    return this.injector.getDependency(name)
  }
})

SuperPipe.Injector = Injector
SuperPipe.Pipeline = Pipeline
