var bind = require('lodash.bind')
var keys = require('lodash.keys')
var filter = require('lodash.filter')
var isArray = require('lodash.isarray')
var indexOf = require('lodash.indexof')
var forEach = require('lodash.foreach')

var RESERVED_DEPS = exports.RESERVED_DEPS = ['autoBind', 'emit',
  'setDep', 'getDep', 'set', 'get',
  'next', 'errPipeName', 'errPipeBody'
]

var CHANGE_EVENT_PREFIX = exports.CHANGE_EVENT_PREFIX = '__superpipe_change__'

/**
 * Static functions
 */

exports.setDep = function(emitter, injector, name, dep, props) {
  var normalized = normalizeSetDepArgs(name, dep, props)

  name = normalized.name
  dep = normalized.dep
  props = normalized.props

  var autoBind = injector.get('autoBind')()
  // check if any name of dependency is reserved
  if (name)
    isDepNameReserved(RESERVED_DEPS, name)
  else
    isDepNameReserved(RESERVED_DEPS, props)

  if (props && 'object' === typeof dep) {
    // setDep('name', value)
    // setDep('name', value, props)
    forEach(props, function(propName) {
      var _name = name ? [name, propName].join(':') : propName
      var depObject = dep[propName]
      if (autoBind && 'function' === typeof depObject)
        depObject = bind(depObject, dep)

      emitter && emitChange(emitter, _name, depObject, injector)
      injector.set(_name, depObject)
    })
  } else if (name) {
    // setDep(name, value)
    emitter && emitChange(emitter, name, dep, injector)
    injector.set(name, dep)
  } else {
    throw new Error('Unsupported function arguments for `setDep`')
  }
}

var emitChange = exports.emitChange = function(emitter, depName, newValue, injector) {
  if (emitter && emitter.listeners) {
    var eventName = CHANGE_EVENT_PREFIX + depName
    if (emitter.listeners(eventName).length > -1)
      emitter.emit(eventName, newValue, injector.get(depName))
  }
}

var isDepNameReserved = exports.isDepNameReserved = function(reservedDeps, name) {
  if ('string' === typeof name && indexOf(reservedDeps, name) > -1) {
    throw new Error('The name of your dependency is reserved: ' + name)
  } else if (isArray(name)) {
    forEach(reservedDeps, function(reserved) {
      if (indexOf(name, reserved) > -1)
        throw new Error('The name of your dependency is reserved: ' + reserved)
    })
  }
  return false
}

var normalizeSetDepArgs = exports.normalizeSetDepArgs = function(name, dep, props) {
  if ('string' !== typeof name) {
    props = dep
    dep = name
    name = null
  }

  if (!name && (!dep || 'object' !== typeof dep))
    throw new Error('Unsupported function arguments for `setDep`')

  if ('string' === typeof props && 'object' === typeof dep) {
    var allKeys = []
    for (var k in dep)
      allKeys.push(k)

    if (props) {
      switch (props) {
        case '*':
          props = filter(allKeys, function(prop) {
            return '_' !== prop[0]
          })
          break
        case '*^':
          props = filter(allKeys, function(prop) {
            return '_' !== prop[0] && 'function' === typeof dep[prop]
          })
          break
        case '*$':
          props = filter(allKeys, function(prop) {
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

  if (!name && !props)
    props = keys(dep)

  return {
    name: name,
    dep: dep,
    props: props
  }
}
