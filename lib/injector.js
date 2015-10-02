'use strict'

var assign = require('lodash.assign')
var toArray = require('lodash.toarray')

module.exports = Injector

function Injector(injector) {
  this.dependencies = {}
  if (injector instanceof Injector) {
    this.mergeInjector(injector)
  }
}

Injector.prototype = {

  regDependency: function(name, dependency) {
    if (typeof name === 'object') {
      var self = this
      Object.keys(name).forEach(function(key) {
        self.regDependency(key, name[key])
      })
      return
    }
    this.dependencies[name] = dependency
  },

  getDependency: function(name) {
    return this.dependencies[name]
  },

  hasDependency: function(name) {
    return this.dependencies.hasOwnProperty(name)
  },

  getDependencies: function(fnArgs, defaultValues) {
    var self = this
    defaultValues = defaultValues || {}
    if (!fnArgs) {
      return defaultValues
    }

    return fnArgs.map(function(dependencyName, idx) {
      if (dependencyName && 'object' === typeof dependencyName) {
        var hashedDeps = {}
        Object.keys(dependencyName).forEach(function(depKey) {
          var depName = dependencyName[depKey]
          hashedDeps[depKey] = self.getDependency(depName)
        })
        return hashedDeps
      } else if (dependencyName === null) {
        return defaultValues[idx]
      } else {
        return self.getDependency(dependencyName)
      }
    })
  },

  mergeInjector: function(otherInjector) {
    assign(this.dependencies, otherInjector.dependencies)
  },

  inject: function(fn, fnArgs) {
    var _fn = fn
    var self = this
    fn = function() {
        var defaultArgs = toArray(arguments)
        var ctx
        var injector

        if (this instanceof Injector) {
          ctx = 0
          injector = this
        } else {
          ctx = this
          injector = this.injector || self
        }
        var _args = injector.getDependencies(fnArgs, defaultArgs)
        return _fn.apply(ctx, _args)
      }
      // keep the original function as a reference
    fn.fn = _fn
    return fn
  }
}
