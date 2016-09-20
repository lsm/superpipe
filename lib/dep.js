var bind = require('lodash.bind')
var keys = require('lodash.keys')
var filter = require('lodash.filter')
var foreach = require('lodash.foreach')
var isArray = require('lodash.isarray')
var indexOf = require('lodash.indexof')
var forEach = require('lodash.foreach')

var RESERVED_DEPS = exports.RESERVED_DEPS = ['autoBind', 'set', 'get', 'next',
  'setGlobal', 'errPipeName', 'errPipeBody']

/**
 * Static functions
 */

exports.setDep = function(injector, name, dep, props) {
  var normalized = normalizeSetDepArgs(name, dep, props)

  name = normalized.name
  dep = normalized.dep
  props = normalized.props

  var autoBind = injector.get('autoBind')
  autoBind = autoBind && autoBind()
  // check if any name of dependency is reserved
  if (name)
    isDepNameReserved(RESERVED_DEPS, name)
  else
    isDepNameReserved(RESERVED_DEPS, props)

  if (props && 'object' === typeof dep) {
    // setDep(value, props)
    // setDep('name', value)
    // setDep('name', value, props)
    forEach(props, function(propName) {
      var _name = name ? [name, propName].join('::') : propName
      var depObject = dep[propName]
      if (autoBind && 'function' === typeof depObject)
        depObject = bind(depObject, dep)

      injector.set(_name, depObject)
    })
  } else if (name) {
    // setDep(name, value)
    injector.set(name, dep)
  } else {
    throw new Error('Unsupported function arguments for `setDep`')
  }

  return this
}

exports.setDepWithState = function(state, name, dep, props) {
  var next = state.next
  var result = state.result
  var setDep = state.setDep
  var supplies = state.supplies
  var setDepMap = state.setDepMap
  var fulfilled = state.fulfilled
  var fnReturned = state.fnReturned

  var normalized = normalizeSetDepArgs(name, dep, props)
  var _dep = normalized.dep
  var _name = normalized.name
  var _props = normalized.props


  // Error happens in previous setDep call return to avoid call error handler twice.
  if (state.hasError)
    return

  if (_name && !_props) {
    var checkName = _name
    var mappedName = setDepMap && setDepMap[_name]
    if (mappedName) {
      // Check against the mapping name
      checkName = _name + ':' + mappedName
      // Set the mappedName as the real dependency name
      _name = mappedName
    }
    checkFulfillment(checkName, state, supplies, fulfilled)
    setDep(_name, _dep)
  } else if (_dep && _props) {
    foreach(_props, function(propName, idx) {
      var nameTOCheck = propName
      var mappedName = setDepMap && setDepMap[propName]
      if (mappedName) {
        // Check against the mapping name
        nameTOCheck = propName + ':' + mappedName
        // Link the propName to the mappedName in _dep
        _dep[mappedName] = _dep[propName]
        // Set the original propName to mappedName so we set `mappedName` as
        // depenency name instead of `propName`
        _props[idx] = mappedName
      }
      checkFulfillment(nameTOCheck, state, supplies, fulfilled)
    })
    setDep(_dep, _props)
  } else {
    throw new Error('Unsupported arguments for in pipe `setDep`.')
  }

  // Call next immediately if there is an error
  if (state.hasError) {
    state.autoNext = false
    next()
  } else if (fulfilled) {
    if (fulfilled.length === supplies.length) {
      // Set the auto next to true or call next when all required
      // supplies are fulfilled.
      if (fnReturned && ('undefined' === typeof result || false !== result))
        // Function has been returned.
        // We should call next when the returned value is either
        // undefined or not false.
        next()
      else
        // Otherwise, let other part of the code to handle when to call next.
        state.autoNext = true
    } else if (fulfilled.length > supplies.length) {
      throw new Error('Got more dependencies than what supplies required.')
    }
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
    throw new Error('Unsupported function arguments for `set`')

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

var ERROR_NAME = 'error'
function checkFulfillment(propName, state, supplies, fulfilled) {
  if (propName === ERROR_NAME)
    state.hasError = true
  else if (-1 === indexOf(supplies, propName))
    throw new Error('Dependency "' + propName + '" is not defined in supplies.')
  if (fulfilled && -1 === indexOf(fulfilled, propName))
    fulfilled.push(propName)
}
