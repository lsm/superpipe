'use strict'
/* globals describe, it */
var bind = require('lodash.bind')
var assume = require('assume')
var SuperPipe = require('../')
var Injector = SuperPipe.Injector
var EventEmitter = require('events').EventEmitter


describe('Pipeline', function() {

  var emitter = new EventEmitter()
  var injector = new Injector()

  describe('#pipe("name of function in deps")', function() {
    var sp = SuperPipe()

    it('should accept string as first argument and get the pipe function use the value of the string and call it', function(done) {
      var pipe = sp()
        .pipe('set')
        .pipe(function(target) {
          assume(target).equals('x')
          done()
        }, 'target').toPipe()
      pipe({
        target: 'x'
      })
    })

    it('should go next if false is returned in `NOT` pipe', function(done) {
      sp.set('returnFalse', function(set) {
        set('abc', 'xyz')
        return false
      })
      sp()
        .pipe('!returnFalse', ['set', 'next'], ['abc'])
        .pipe(function(abc) {
          assume(abc).equals('xyz')
          done()
        }, 'abc')()
    })

    it('should not go next if true is the value of the `NOT` pipe', function() {
      sp.set('iamtrue', true)
      sp()
        .pipe('!iamtrue')
        .pipe(function() {
          throw new Error('This pipe should not be executed.')
        })()
    })

    it('should accept object as hashed dependencies', function() {
      var hashedDeps = function(obj, fn) {
        assume(obj.myFn).equals(hashedDeps)
        assume(fn).equals(hashedDeps)
      }
      sp.set('hashedDeps', hashedDeps)
      sp().pipe('hashedDeps', [{
        myFn: 'hashedDeps'
      }, 'hashedDeps'])()
    })

    it('should bypass optional pipes when dependencies are not satisfied', function(done) {
      var injector = new Injector()

      injector.set('arg1', 'arg1 value')
      injector.set('func1', function(arg1) {
        assume(arg1).equals('arg1 value')
        return {
          arg2: 'arg2 value'
        }
      })
      injector.set('func2', function() {
        throw new Error('This function should be never called')
      })
      injector.set('func3', function(arg2) {
        assume(arg2).equals('arg2 value')
        done()
      })

      var pl = SuperPipe.pipeline()
        .pipe('func1', 'arg1', 'arg2')
        .pipe('missingFunction?', 'arg2')
        .pipe('func2?', 'no such argument')
        .pipe('func3', 'arg2')

      pl.toPipe(injector)()
    })

    it('should throw if pipe function loaded is not a function or boolean', function() {
      var injector = new Injector()
      injector.set('func', {})
      var pl = SuperPipe.pipeline().pipe('func')

      assume(function() {
        pl(injector)
      }).throws(/^Dependency `func` is not a function\./)
    })

  })

  describe('#pipe("emit")', function() {

    it('should use deps as event name and use supplies as deps for "emit" pipe', function(done) {
      var sp = SuperPipe()
      sp
        .set({
          obj: 'obj 1',
          event: 'data 1'
        })
        .set('emit', bind(emitter.emit, emitter))

      emitter.on('event 1', sp()
        .pipe(function(event, obj) {
          assume(event).equals('data 1')
          assume(obj).equals('obj 1')
          done()
        }).toPipe()
      )

      sp().pipe('emit', 'event 1', ['event', 'obj'])()
    })

  })

  describe('#pipe(number)', function() {
    var sp = SuperPipe(injector)
    var pipeline = sp()

    it('should throttle the events emitted', function(done) {
      var normalCounter = 0
      var throttledCounter = 0
      var pipe = pipeline
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
        }).toPipe()

      for (var i = 0; i < 10; i++)
        pipe()

      setTimeout(pipe, 200)
    })
  })

  describe('#wait(msec)', function() {
    it('should wait for x msec and continue', function(done) {
      var start
      SuperPipe.pipeline()
        .pipe(function() {
          start = (new Date()).getTime()
        })
        .wait(1000)
        .pipe(function() {
          assume((new Date()).getTime() - start > 500).equals(true)
          done()
        })()
    })
  })

  describe('#pipe(function, dependencies)', function() {
    function clickHandler() {
    }

    function processer(handlerFn, done) {
      assume(handlerFn).equals(clickHandler)
      done()
      return true
    }

    var sp = SuperPipe(injector)
    sp.set('handleClick', clickHandler)

    it('should throw if fn is not a function or name of a dependency function', function() {
      assume(function() {
        sp().pipe({})
      }).throws(/^fn should be a function, got/)
    })

    it('should accept array as dependencies', function(done) {
      sp.set('done', done)
      sp().pipe(processer, ['handleClick', 'done'])()
    })

    it('should has 0 or null as context for each pipeline functions', function(done) {
      sp().pipe(function() {
        assume(+this).equals(0)
        done()
      })()
    })

    it('should keep the original argument if null is provided while still provide the right dependency need to be injected', function(done) {
      sp.set('done', done)
      var pipe = sp()
        .pipe(function(event, next) {
          assume(event.target).equals('a')
          next()
        }, [null, 'next'])
        .pipe('done', 'error').toPipe()
      pipe({
        target: 'a'
      })
    })

    it('should not register get as a dependency', function(done) {
      sp().pipe(function(get) {
        assume(get).equals(undefined)
        done()
      }, 'get')()
    })

    it('should register set as dependencies and bind with dependencies of current pipeline', function(done) {
      sp.set('done', done)
      var pipe = sp()
        .pipe(function(set) {
          assume(sp.set).not.equals(set)
          sp.set('key', 'old value')
          set('key', 'new value')
        }, 'set')
        .pipe(function(key) {
          assume(key).equals('new value')
          assume(sp.get('key')).equals('old value')
          done()
        }, 'key').toPipe()

      pipe({
        target: 'a'
      })
    })
  })

  describe('#pipe(function, dependencies, supplies)', function() {
    var superpipe = SuperPipe(injector)

    it('should go next pipe when all supplies are fulfilled.', function(done) {
      superpipe.set('key1', 'value1')
      emitter.on('deps supplies', superpipe()
        .pipe(function(key1, set) {
          assume(key1).equals('value1')
          set('key2', 'value2')
          setTimeout(function() {
            set('key3', 'value3')
          }, 10)
        }, ['key1', 'set'], ['key2', 'key3'])
        .pipe(function(set) {
          set({
            key4: 'value4',
            key5: 'value5'
          })
        }, 'set', ['key4', 'key5'])
        .pipe(function(set) {
          setTimeout(function() {
            set('key6', 'value6')
          })
          return true
        }, 'set', 'key6')
        .pipe(function(key2, key3, key4, key5) {
          assume(key2).equals('value2')
          assume(key3).equals('value3')
          assume(key4).equals('value4')
          assume(key5).equals('value5')
          done()
        }, ['key2', 'key3', 'key4', 'key5'])
        .toPipe())

      emitter.emit('deps supplies')
    })

    it('should not go next automatically if `next` is provided as dependency', function() {
      emitter.on('next', superpipe()
        .pipe(function(set) {
          set('abc', 'xyz')
        }, ['set', 'next'], ['abc'])
        .pipe(function() {
          throw new Error('This pipe should not be executed.')
        }, 'abc'))

      emitter.emit('next')
    })

    it('should not go next if has `err`', function() {
      emitter.on('err', superpipe()
        .pipe(function(set, next) {
          set('abc', 'xyz')
          next('error!')
        }, ['set', 'next'], ['abc'])
        .pipe(function() {
          throw new Error('This pipe should not be executed.')
        }, 'abc')
      )

      emitter.emit('xyz')
    })

    it('should not go next if false is returned', function() {
      superpipe()
        .pipe(function(set) {
          set('abc', 'xyz')
          return false
        }, 'set', ['abc'])
        .pipe(function() {
          throw new Error('This pipe should not be executed.')
        }, 'abc')()
    })

    it('should set dependencies using next', function() {
      superpipe()
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
        }, ['nextDep1', 'nextDep2', 'nextDep3'])()
    })

    it('should not go next if set with `error`', function() {
      var pl = SuperPipe.pipeline()
      pl.pipe(function(set) {
        set('theKey1', 'the value1')
        set({
          'error': 'do not go next',
          'theKey3': 'the value3'
        })
        set('theKey2', 'the value2')
      }, 'set', ['theKey1', 'theKey2', 'theKey3'])
        .pipe(function() {
          throw new Error('This should be never called.')
        })
        .error(function(error, theKey1, theKey2, theKey3) {
          assume(error).equals('do not go next')
          assume(theKey1).equals('the value1')
          assume(theKey2).equals(undefined)
          assume(theKey3).equals('the value3')
        }, ['error', 'theKey1', 'theKey2', 'theKey3'])

      pl(superpipe)
    })

    it('should map the dependency names correctly', function(done) {
      var pl = SuperPipe.pipeline()
      pl.pipe(function(set) {
        set('myKey1', 'my value1')
      }, 'set', 'myKey1:yourKey1')
        .pipe(function(set, yourKey1) {
          assume(yourKey1).equals('my value1')
          set({
            myKey2: 'my value2',
            myKey3: 'my value3'
          })
        }, ['set', 'yourKey1'], ['myKey2:yourKey2', 'myKey3'])
        .pipe(function(yourKey2, myKey3) {
          assume(yourKey2).equals('my value2')
          assume(myKey3).equals('my value3')
          done()
        }, ['yourKey2', 'myKey3'])
      pl()
    })

    it('should set mapped dependency names through next', function(done) {
      var pl = SuperPipe.pipeline()
      pl.pipe(function(next) {
        next(null, 'myKey1', 'my value1')
      }, 'next', 'myKey1:yourKey1')
        .pipe(function(next, yourKey1) {
          assume(yourKey1).equals('my value1')
          next(null, {
            myKey2: 'my value2',
            myKey3: 'my value3'
          })
        }, ['next', 'yourKey1'], ['myKey2:yourKey2', 'myKey3'])
        .pipe(function(yourKey2, myKey3) {
          assume(yourKey2).equals('my value2')
          assume(myKey3).equals('my value3')
          done()
        }, ['yourKey2', 'myKey3'])
      pl()
    })

    it('should throw if type of deps/supplies are not correct', function() {
      var injector = new Injector()
      injector.set('func', function() {
        throw new Error('This function should be never called.')
      })
      assume(function() {
        SuperPipe.pipeline().pipe('func', function() {})(injector)
      }).throws('`dependencies` should be either string, array or object of dependency names if present')

      assume(function() {
        SuperPipe.pipeline().pipe('func', null, true)(injector)
      }).throws('supplies should be either string or array of dependency names if present')
    })

  })

  describe('#pipe(function, [3, "dep1", "dep2"])', function() {
    it('should skip dependencies by number and get the default values by position.', function() {
      var sp = SuperPipe()
      sp.set('dep1', 'value1')
      sp.set('dep2', 'value2')

      sp()
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
        }, [3, 'dep1', 'dep2'])('event data', 'event data2', 'event data3')
    })
  })

  describe('#pipe("set", dependencies, supplies)', function() {
    it('should set all dependencies to the pipeline', function(done) {
      var input = {
        setdep1: 'value1',
        setdep2: 'value2'
      }
      SuperPipe.pipeline()
        .pipe('set')
        .pipe(function(setdep1, setdep2) {
          assume(setdep1).equals(input.setdep1)
          assume(setdep2).equals(input.setdep2)
          done()
        }, ['setdep1', 'setdep2']).toPipe()(input)
    })

    it('should set dependencies by supplies to the pipeline', function(done) {
      var input = {
        setdep1: 'value1',
        setdep2: 'value2',
        setdep3: 'value3'
      }
      SuperPipe.pipeline()
        .pipe('set', null, ['setdep2', 'setdep1'])
        .pipe(function(setdep1, setdep2) {
          assume(setdep1).equals(input.setdep1)
          assume(setdep2).equals(input.setdep2)
          done()
        }, ['setdep1', 'setdep2']).toPipe()(input)
    })

    it('should set dependencies by positions of arguments to pipeline', function(done) {
      var setdep1 = 'value1'
      var setdep2 = 'value2'
      var setdep3 = 'value3'
      SuperPipe.pipeline()
        .pipe('set', 2, ['posdep2', 'posdep1'])
        .pipe(function(posdep1, posdep2) {
          assume(posdep1).equals(setdep1)
          assume(posdep2).equals(setdep2)
        }, ['posdep1', 'posdep2']).toPipe()(setdep2, setdep1, setdep3)

      SuperPipe.pipeline()
        .pipe('set', null, ['posdep1', 'posdep2'])
        .pipe(function(posdep1, posdep2) {
          assume(posdep1).equals(setdep1)
          assume(posdep2).equals(setdep2)
          done()
        }, ['posdep1', 'posdep2']).toPipe()(setdep1, setdep2, setdep3)
    })

    it('should set dependencies by mapping of arguments to pipeline', function(done) {
      var setdep1 = 'value1'
      var setdep2 = 'value2'
      var setdep3 = 'value3'
      SuperPipe.pipeline()
        .pipe('set', {
          'mappeddep2': 0,
          'mappeddep1': 1
        })
        .pipe(function(mappeddep1, mappeddep2) {
          assume(mappeddep1).equals(setdep1)
          assume(mappeddep2).equals(setdep2)
          done()
        }, ['mappeddep1', 'mappeddep2']).toPipe()(setdep2, setdep1, setdep3)
    })

  })

  describe('#error', function() {
    var sp = SuperPipe(injector)
    sp.set('dep1', 1)
    var pipeline = sp()
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
      pipeline.toPipe()(normalMessage)
    })

    it('should call error handler with requested dependencies', function(done) {
      pipeline.error(function(err, arg1, errPipeName) {
        assume(err).equals(errMessage)
        assume(arg1).equals(1)
        assume(errPipeName).equals('functionWithError')
        done()
      }, [null, 'dep1', 'errPipeName'])
      pipeline(normalMessage)
    })

    it('should throw if no error handler is provided', function() {
      var pl = SuperPipe.pipeline()
      pl.pipe(function(value) {
        assume(value).equals(1)
      }, 'dep1')
        .pipe(function(next) {
          next('no error handler')
        }, 'next')
      assume(function() {
        pl.toPipe(sp)()
      }).throws(/^no error handler/)
    })
  })

  describe('#debug', function() {
    it('should output debug info on execution', function(done) {
      var injector = new Injector()
      injector.set('step1', function(input1, input2, input3) {
        assume(input1).equals('input1')
        assume(input2).equals('input2')
        assume(input3).equals(undefined)
        return {
          dep1: 'dep1 value'
        }
      })
      injector.set('step2', function(dep1, next) {
        assume(dep1).equals('dep1 value')
        setTimeout(function() {
          next(null, {
            dep2: 'dep2 value',
            dep3: 'dep3 value'
          })
        })
      })
      injector.set('step3', function(dep2, dep3, set) {
        assume(dep2).equals('dep2 value')
        assume(dep3).equals('dep3 value')
        set({
          result: 'step3 result is here'
        })
      })
      function debug(tpl, pipelineName, idx, fnName, result) {
        assume(pipelineName).equals('debugPipeline')
        switch (idx) {
          case 0:
            assume(fnName).equals('step1')
            break
          case 1:
            assume(fnName).equals('step2')
            break
          case 2:
            assume(fnName).equals('step3')
            break
        }
        if (2 === idx && '"step3 result is here"' === result)
          done()
      }
      var pl = SuperPipe.pipeline()
      var pipe = pl.debug(debug)
        .pipe('step1', 2, 'dep1')
        .pipe('step2', ['dep1', 'next'], ['dep2', 'dep3'])
        .pipe('step3', ['dep2', 'dep3', 'set'], 'result')
        .toPipe(injector, 'debugPipeline')
      assume(pl.debug()).equals(debug)
      pipe('input1', 'input2', 'input3')
    })
  })
})
