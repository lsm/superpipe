/* globals describe, beforeEach, it*/
var SuperPipe = require('../')
var assume = require('assume')
var forEach = require('lodash.foreach')

describe('SuperPipe', function() {

  describe('#constructor', function() {
    it('should return an instance of SuperPipe', function() {
      var sp = new SuperPipe()
      assume(sp).is.instanceOf(SuperPipe)
      assume(sp.listenTo).is.a('function')
      assume(sp.setDep).is.a('function')
      assume(sp.getDep).is.a('function')
    })

    it('should register function members as dependencies', function() {
      var sp = new SuperPipe()
      assume(sp.autoBind).is.a('function')
      assume(sp.isDepNameReserved).is.a('function')
    })
  })

  describe('#setDep/#getDep', function() {
    var sp
    var depStr = 'example'
    var DepClass = function() {}

    DepClass.prototype = {
      x: 1,
      y: 2,
      z: 'z',
      fn1: function fn1() {},
      fn2: function fn2() {},
      _x: 10,
      _fn: function() {}
    }

    var depObject = new DepClass()

    beforeEach(function() {
      sp = new SuperPipe()
    })

    it('should throw if arguments signature is not recognized', function() {
      assume(function() {
        sp.setDep()
      }).throws(/^Unsupported function arguments/)
      assume(function() {
        sp.setDep(function() {})
      }).throws(/^Unsupported function arguments/)
    })

    it('should be okay to set falsity values as dependencies', function() {
      sp.setDep('name', '')
      assume(sp.getDep('name')).equals('')
      sp.setDep('name')
      assume(sp.getDep('name')).equals(undefined)
      sp.setDep('name', null)
      assume(sp.getDep('name')).equals(null)
      sp.setDep('name', false)
      assume(sp.getDep('name')).equals(false)
      sp.setDep('name', 0)
      assume(sp.getDep('name')).equals(0)
    })

    it('should throw if set dependency with reserved name', function() {
      assume(function() {
        sp.setDep({
          setDep: 1
        })
      }).throws(/The name of your dependency is reserved:/)
      forEach(sp.reservedDeps, function(reserved) {
        assume(function() {
          sp.setDep(reserved, {})
        }).throws(/The name of your dependency is reserved:/)
      })
    })

    it('should set dependency with name and value', function() {
      sp.setDep('dep1', depObject)
      assume(depObject).deep.equals(sp.getDep('dep1'))
    })

    it('should override old dependency with new value', function() {
      sp.setDep('dep1', depObject)
      sp.setDep('dep1', depStr)
      assume(sp.getDep('dep1')).equals(depStr)
    })

    it('should accept object and add all properties as dependencies', function() {
      var obj = {
        a: 'a',
        b: 2
      }
      sp.setDep(obj)
      assume(sp.getDep('a')).equals(obj.a)
      assume(sp.getDep('b')).equals(obj.b)
    })

    it('should add all properties except functions as dependencies if props is *$', function() {
      sp.setDep(depObject, '*$')
      assume(sp.getDep('x')).equals(depObject.x)
      assume(sp.getDep('y')).equals(depObject.y)
      assume(sp.getDep('z')).equals(depObject.z)
      assume(sp.getDep('fn1')).is.not.exist()
      assume(sp.getDep('fn2')).is.not.exist()
    })

    it('should add all functions as dependencies if props is *^', function() {
      sp.setDep(depObject, '*^')
      assume(sp.getDep('fn1')).equals(depObject.fn1)
      assume(sp.getDep('fn2')).equals(depObject.fn2)
      assume(sp.getDep('x')).is.not.exist()
      assume(sp.getDep('y')).is.not.exist()
      assume(sp.getDep('z')).is.not.exist()
    })

    it('should use name as prefix', function() {
      sp.setDep('prefix', depObject, '*^')
      assume(sp.getDep('prefix:fn1')).equals(depObject.fn1)
      assume(sp.getDep('prefix:fn2')).equals(depObject.fn2)
      assume(sp.getDep('prefix:x')).is.not.exist()
      assume(sp.getDep('prefix:y')).is.not.exist()
      assume(sp.getDep('prefix:z')).is.not.exist()
    })

    it('should add all properties as dependencies if props is *', function() {
      sp.setDep('name', depObject, '*')
      assume(sp.getDep('name:x')).equals(depObject.x)
      assume(sp.getDep('name:y')).equals(depObject.y)
      assume(sp.getDep('name:z')).equals(depObject.z)
      assume(sp.getDep('name:fn1')).equals(depObject.fn1)
      assume(sp.getDep('name:fn2')).equals(depObject.fn2)
    })

    it('should not register dependencies start with _ when props is any of */*$/*^', function() {
      sp.setDep('name', depObject, '*')
      assume(sp.getDep('_x')).equals(undefined)
      assume(sp.getDep('_fn')).equals(undefined)

      sp = new SuperPipe()
      sp.setDep('name', depObject, '*^')
      assume(sp.getDep('_fn')).equals(undefined)

      sp = new SuperPipe()
      sp.setDep('name', depObject, '*$')
      assume(sp.getDep('_x')).equals(undefined)
    })
  })

  describe('#autoBind', function() {
    it('should bind the right context to function dependencies when autoBind is true', function(done) {
      var sp = new SuperPipe()
      var context = {
        fn1: function() {
          assume(this).equals(context)
          this.fn1Called = true
        },
        fn2: function() {
          assume(context.fn1Called).equals(true)
          assume(this).is.not.equal(context)
          done()
        }
      }
      sp.autoBind(true)
      sp.setDep(context, '*^')
      sp.getDep('fn1').call({})

      sp.autoBind(false)
      sp.setDep(context, '*^')
      sp.getDep('fn2').call({})
    })
  })

  describe('#pipeline', function() {
    var sp = new SuperPipe()
    it('should return a function which is instance of Pipeline', function() {
      assume(sp.pipeline()).is.a('function')
    })
  })

  describe('#listenTo', function() {
    var sp = new SuperPipe()
    it('should return a function which is instance of Pipeline', function() {
      assume(sp.listenTo('click')).is.a('function')
    })
  })
})
