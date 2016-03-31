'use strict'
/* globals describe, it */
var assume = require('assume')
var SuperPipe = require('../')
var Pipeline = SuperPipe.Pipeline
var Injector = SuperPipe.Injector
var EventEmitter = require('events').EventEmitter


describe('Pipeline', function() {

  var emitter = new EventEmitter()
  var injector = new Injector()


  describe('#listenTo(emitter, name)', function() {
    var sp = new SuperPipe(injector)
    var pipeline = new Pipeline(sp)
    it('should return a function as instance', function() {
      assume(pipeline.listenTo('click')).is.a('function')
    })

    it('should throw if listenFn is not a function', function() {
      assume(function() {
        pipeline.listenTo({}, 'click')
      }).throws(/^emitter has no listening funciton "on, addEventListener or addListener"/)
    })
  })

  describe('#listenTo("emitterName", eventName)', function() {
    it('should listen to the event if the named emitter is available', function(done) {
      var injector = new Injector()
      var sp = new SuperPipe(injector)
      var pipeline = new Pipeline(sp)

      var emitter = new EventEmitter()
      sp.setDep('myEmitter', emitter)
      emitter.emit('click', 'other event')

      pipeline
        .listenTo('myEmitter', 'click')
        .pipe(function(event) {
          assume(event).equals('my event')
          done()
        })

      emitter.emit('click', 'my event')
    })

    it('should listen to the event once the named emitter becomes available', function(done) {
      var injector = new Injector()
      var sp = new SuperPipe(injector)
      var pipeline = new Pipeline(sp)

      pipeline
        .listenTo('myEmitter', 'click')
        .pipe(function(event) {
          assume(event).equals('my event')
          done()
        })

      var emitter = new EventEmitter()
      emitter.emit('click', 'other event')

      sp.setDep('myEmitter', emitter)
      emitter.emit('click', 'my event')
    })
  })

  describe('#pipe("name of function in deps")', function() {
    var emitter = new EventEmitter()
    var sp = new SuperPipe()
    var pipeline = sp
      .listenTo(emitter, 'click')

    it('should accept string as first argument and get the pipe function use the value of the string and call it', function(done) {
      pipeline
        .pipe('setDep')
        .pipe(function(target) {
          assume(target).equals('x')
          done()
        }, 'target')
      emitter.emit('click', {
        target: 'x'
      })
    })

    it('should go next if false is returned in `NOT` pipe', function(done) {
      sp.setDep('returnFalse', function(setDep) {
        setDep('abc', 'xyz')
        return false
      })
      sp.listenTo('not false')
        .pipe('!returnFalse', ['setDep', 'next'], ['abc'])
        .pipe(function(abc) {
          assume(abc).equals('xyz')
          done()
        }, 'abc')

      sp.emit('not false')
    })

    it('should not go next if true is the value of the `NOT` pipe', function() {
      sp.setDep('iamtrue', true)
      sp.listenTo('is true')
        .pipe('!iamtrue')
        .pipe(function() {
          throw new Error('This pipe should not be executed.')
        })

      sp.emit('is true')
    })

    it('should accept object as hashed dependencies', function() {
      var hashedDeps = function(obj, fn) {
        assume(obj.myFn).equals(hashedDeps)
        assume(fn).equals(hashedDeps)
      }
      sp.setDep('hashedDeps', hashedDeps)
        .listenTo(emitter, 'keydown')
        .pipe('hashedDeps', [{
          myFn: 'hashedDeps'
        }, 'hashedDeps'])
      emitter.emit('keydown')
    })
  })

  describe('#pipe("emit")', function() {

    it('should use deps as event name and use supplies as deps for "emit" pipe', function(done) {
      var sp = new SuperPipe()
      sp.setDep({
        obj: 'obj 1',
        event: 'data 1'
      })

      sp.listenTo('event 1')
        .pipe(function(event, obj) {
          assume(event).equals('data 1')
          assume(obj).equals('obj 1')
          done()
        })

      sp.listenTo(sp, 'event 2')
        .pipe('emit', 'event 1', ['event', 'obj'])

      sp.emit('event 2')
    })

  })

  describe('#pipe(number)', function() {
    var sp = new SuperPipe(injector)
    var pipeline = sp.listenTo('fast')

    it('should throttle the events emitted', function(done) {
      var normalCounter = 0
      var throttledCounter = 0
      pipeline
        .pipe(function() {
          normalCounter++
        })
        .pipe(100)
        .pipe(function() {
          throttledCounter++
          if (2 === throttledCounter) {
            assume(normalCounter).equals(11)
            done()
          }
        })

      for (var i = 0; i < 10; i++)
        sp.emit('fast')

      setTimeout(function() {
        sp.emit('fast')
      }, 200)
    })
  })

  describe('#pipe(function, dependencies)', function() {
    function clickHandler() {
    }

    var value = 1

    function processer(handlerFn, setDep) {
      assume(handlerFn).equals(clickHandler)
      setDep('valueFromProcesserA', value)
      value++
      return true
    }

    var sp = new SuperPipe(injector)
    var pipeline = sp
      .setDep('handleClick', clickHandler)
      .listenTo(emitter, 'click')

    it('should throw if fn is not a function or name of a dependency function', function() {
      assume(function() {
        pipeline.pipe({})
      }).throws(/^fn should be a function, got/)
    })

    it('should accept mutiple arguments string as dependencies', function() {
      pipeline.pipe(processer, ['handleClick', 'setDep'])
      emitter.emit('click')
    })

    it('should accept array as dependencies', function() {
      pipeline.pipe(processer, ['handleClick', 'setDep'])
      emitter.emit('click')
    })

    it('should has 0 or null as context for each pipeline functions', function() {
      pipeline.pipe(function() {
        assume(+this).equals(0)
      })
    })

    it('should keep the original argument if null is provided while still provide the right dependency need to be injected', function() {
      pipeline
        .pipe(function(event, next) {
          assume(event.target).equals('a')
          next()
        }, [null, 'next'])
      emitter.emit('click', {
        target: 'a'
      })

    })

    it('should not register getDep as a dependency', function() {
      pipeline.pipe(function(getDep) {
        assume(getDep).equals(undefined)
      }, 'getDep')
    })

    it('should register setDep as dependencies and bind with dependencies of current pipeline', function(done) {
      pipeline
        .pipe(function(setDep) {
          assume(sp.setDep).not.equals(setDep)
          sp.setDep('key', 'old value')
          setDep('key', 'new value')
        }, 'setDep')
        .pipe(function(key) {
          assume(key).equals('new value')
          assume(sp.getDep('key')).equals('old value')
          done()
        }, 'key')

      emitter.emit('click', {
        target: 'a'
      })
    })

    it('should call the piped stream functions for the correct times', function() {
      assume(value).equals(8)
    })
  })

  describe('#pipe(function, dependencies, supplies)', function() {
    var superpipe = new SuperPipe(injector)

    it('should go next pipe when all supplies are fulfilled.', function(done) {
      superpipe.setDep('key1', 'value1')
        .listenTo('deps supplies')
        .pipe(function(key1, setDep) {
          assume(key1).equals('value1')
          setDep('key2', 'value2')
          setTimeout(function() {
            setDep('key3', 'value3')
          }, 10)
        }, ['key1', 'setDep'], ['key2', 'key3'])
        .pipe(function(setDep) {
          setDep({
            key4: 'value4',
            key5: 'value5'
          })
        }, 'setDep', ['key4', 'key5'])
        .pipe(function(setDep) {
          setTimeout(function() {
            setDep('key6', 'value6')
          })
          return true
        }, 'setDep', 'key6')
        .pipe(function(key2, key3, key4, key5) {
          assume(key2).equals('value2')
          assume(key3).equals('value3')
          assume(key4).equals('value4')
          assume(key5).equals('value5')
          done()
        }, ['key2', 'key3', 'key4', 'key5'])

      superpipe.emit('deps supplies')
    })

    it('should not go next automatically if `next` is provided as dependency', function() {
      superpipe.listenTo('next')
        .pipe(function(setDep, next) {
          setDep('abc', 'xyz')
        }, ['setDep', 'next'], ['abc'])
        .pipe(function(abc) {
          throw new Error('This pipe should not be executed.')
        }, 'abc')

      superpipe.emit('next')
    })

    it('should not go next if has `err`', function() {
      superpipe.listenTo('err')
        .pipe(function(setDep, next) {
          setDep('abc', 'xyz')
          next('error!')
        }, ['setDep', 'next'], ['abc'])
        .pipe(function(abc) {
          throw new Error('This pipe should not be executed.')
        }, 'abc')

      superpipe.emit('xyz')
    })

    it('should not go next if false is returned', function() {
      superpipe.listenTo('false')
        .pipe(function(setDep) {
          setDep('abc', 'xyz')
          return false
        }, 'setDep', ['abc'])
        .pipe(function(abc) {
          throw new Error('This pipe should not be executed.')
        }, 'abc')

      superpipe.emit('false')
    })

    it('should set dependencies using next', function() {
      superpipe.listenTo('setDepsThroughNext')
        .pipe(function(next) {
          next(null, 'nextDep1', 'nextValue1')
        }, 'next', ['nextDep1'])
        .pipe(function(next, nextDep1) {
          assume(nextDep1).equals('nextValue1')
          next(null, {
            nextDep2: 'nextValue2',
            nextDep3: 'nextValue3'
          })
        }, ['next', 'nextDep1'], ['nextDep2', 'nextDep3'])
        .pipe(function(nextDep1, nextDep2, nextDep3) {
          assume(nextDep1).equals('nextValue1')
          assume(nextDep2).equals('nextValue2')
          assume(nextDep3).equals('nextValue3')
        }, ['nextDep1', 'nextDep2', 'nextDep3'])

      superpipe.emit('setDepsThroughNext')
    })
  })

  describe('#pipe(function, [3, "dep1", "dep2"])', function() {
    it('should skip dependencies by number and get the default values by position.', function() {
      var sp = new SuperPipe()
      sp.setDep('dep1', 'value1')
      sp.setDep('dep2', 'value2')

      sp.listenTo('skip')
        .pipe(function(data, dep1, dep2) {
          assume(data).equals('event data')
          assume(dep1).equals('value1')
          assume(dep2).equals('value2')
        }, [1, 'dep1', 'dep2'])
        .pipe(function(data, data2, data3, dep1, dep2) {
          assume(data).equals('event data')
          assume(data2).equals('event data2')
          assume(data3).equals('event data3')
          assume(dep1).equals('value1')
          assume(dep2).equals('value2')
        }, [3, 'dep1', 'dep2'])

      sp.emit('skip', 'event data', 'event data2', 'event data3')
    })
  })

  describe('#error', function() {
    var sp = new SuperPipe(injector)
    sp.setDep('dep1', 1)
    var pipeline = sp.listenTo(emitter, 'normal')
    var errMessage = 'Error message'
    var normalMessage = 'Normal message'

    it('should call error handler when next is called with truthy first argument', function(done) {
      pipeline
        .pipe(function normalFunction(msg) {
          assume(msg).equals(normalMessage)
        })
        .pipe(function functionWithError(next) {
          next(errMessage)
        }, 'next')
      pipeline.error(function(err) {
        assume(err).equals(errMessage)
        done()
      })
      emitter.emit('normal', normalMessage)
    })

    it('should call error handler with requested dependencies', function(done) {
      pipeline.error(function(err, arg1, errPipeName) {
        assume(err).equals(errMessage)
        assume(arg1).equals(1)
        assume(errPipeName).equals('functionWithError')
        done()
      }, [null, 'dep1', 'errPipeName'])
      emitter.emit('normal', normalMessage)
    })

    it('should throw if no error handler is provided', function() {
      var pl = SuperPipe()
      pl.pipe(function(value) {
        assume(value).equals(1)
      }, 'dep1')
        .pipe(function(next) {
          next('no error handler')
        }, 'next')
      assume(function() {
        pl(sp)
      }).throws(/^no error handler/)
    })
  })

  describe('events', function() {
    var sp = new SuperPipe()
    it('should get `emit` as dependency and trigger the event', function(done) {
      sp
        .listenTo('eventA')
        .pipe(function(emit) {
          emit('eventB', 'data of eventB')
        }, 'emit')
      sp
        .listenTo('eventB')
        .pipe(function(data) {
          assume(data).equals('data of eventB')
          done()
        })
      sp.emit('eventA')
    })
  })
})
