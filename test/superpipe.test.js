/* globals describe, beforeEach, it*/
var SuperPipe = require('../')
var assume = require('assume')
var forEach = require('lodash.foreach')

describe('SuperPipe', function() {

  describe('#constructor', function() {
    it('should return an instance of SuperPipe', function() {
      var sp = SuperPipe()
      assume(sp.instanceOfSuperPipe).equals(true)
      assume(sp.set).is.a('function')
      assume(sp.get).is.a('function')
    })

    it('should register function members as dependencies', function() {
      var sp = SuperPipe()
      assume(sp.autoBind).is.a('function')
    })
  })

  describe('#set/#get', function() {
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
      sp = SuperPipe()
      sp.autoBind(false)
    })

    it('should throw if arguments signature is not recognized', function() {
      assume(function() {
        sp.set()
      }).throws(/^Unsupported function arguments/)
      assume(function() {
        sp.set(function() {})
      }).throws(/^Unsupported function arguments/)
    })

    it('should be okay to set falsity values as dependencies', function() {
      sp.set('name', '')
      assume(sp.get('name')).equals('')
      sp.set('name')
      assume(sp.get('name')).equals(undefined)
      sp.set('name', null)
      assume(sp.get('name')).equals(null)
      sp.set('name', false)
      assume(sp.get('name')).equals(false)
      sp.set('name', 0)
      assume(sp.get('name')).equals(0)
    })

    it('should throw if set dependency with reserved name', function() {
      assume(function() {
        sp.set({
          set: 1
        })
      }).throws(/The name of your dependency is reserved:/)
      forEach(sp.reservedDeps, function(reserved) {
        assume(function() {
          sp.set(reserved, {})
        }).throws(/The name of your dependency is reserved:/)
      })
    })

    it('should set dependency with name and value', function() {
      sp.set('dep1', depObject)
      assume(depObject).deep.equals(sp.get('dep1'))
    })

    it('should override old dependency with new value', function() {
      sp.set('dep1', depObject)
      sp.set('dep1', depStr)
      assume(sp.get('dep1')).equals(depStr)
    })

    it('should accept object and add all properties as dependencies', function() {
      var obj = {
        a: 'a',
        b: 2
      }
      sp.set(obj)
      assume(sp.get('a')).equals(obj.a)
      assume(sp.get('b')).equals(obj.b)
    })

    it('should add all properties except functions as dependencies if props is *$', function() {
      sp.set(depObject, '*$')
      assume(sp.get('x')).equals(depObject.x)
      assume(sp.get('y')).equals(depObject.y)
      assume(sp.get('z')).equals(depObject.z)
      assume(sp.get('fn1')).is.not.exist()
      assume(sp.get('fn2')).is.not.exist()
    })

    it('should add all functions as dependencies if props is *^', function() {
      sp.set(depObject, '*^')
      assume(sp.get('fn1')).equals(depObject.fn1)
      assume(sp.get('fn2')).equals(depObject.fn2)
      assume(sp.get('x')).is.not.exist()
      assume(sp.get('y')).is.not.exist()
      assume(sp.get('z')).is.not.exist()
    })

    it('should use name as prefix', function() {
      sp.set('prefix', depObject, '*^')
      assume(sp.get('prefix::fn1')).equals(depObject.fn1)
      assume(sp.get('prefix::fn2')).equals(depObject.fn2)
      assume(sp.get('prefix::x')).is.not.exist()
      assume(sp.get('prefix::y')).is.not.exist()
      assume(sp.get('prefix::z')).is.not.exist()
    })

    it('should add all properties as dependencies if props is *', function() {
      sp.set('name', depObject, '*')
      assume(sp.get('name::x')).equals(depObject.x)
      assume(sp.get('name::y')).equals(depObject.y)
      assume(sp.get('name::z')).equals(depObject.z)
      assume(sp.get('name::fn1')).equals(depObject.fn1)
      assume(sp.get('name::fn2')).equals(depObject.fn2)
    })

    it('should not register dependencies start with _ when props is any of */*$/*^', function() {
      sp.set('name', depObject, '*')
      assume(sp.get('_x')).equals(undefined)
      assume(sp.get('_fn')).equals(undefined)

      sp = new SuperPipe()
      sp.set('name', depObject, '*^')
      assume(sp.get('_fn')).equals(undefined)

      sp = new SuperPipe()
      sp.set('name', depObject, '*$')
      assume(sp.get('_x')).equals(undefined)
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
      sp.set(context, '*^')
      sp.get('fn1').call({})

      sp.autoBind(false)
      sp.set(context, '*^')
      sp.get('fn2').call({})
    })
  })

  describe('#()', function() {
    var sp = SuperPipe()
    it('should return a function which is instance of Pipeline', function() {
      assume(sp()).is.a('function')
    })
    it('should return an instance of Pipeline and set name for the pipeline', function() {
      var pl = sp('myPipeline')
      assume(pl.Name()).equals('myPipeline')
    })
  })
})
