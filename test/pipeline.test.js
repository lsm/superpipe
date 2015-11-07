'use strict';
/* globals describe, it */
var assume = require('assume');
var SuperPipe = require('../');
var Pipeline = SuperPipe.Pipeline;
var Injector = SuperPipe.Injector;
var EventEmitter = require('events').EventEmitter;


describe('Pipeline', function() {

  var emitter = new EventEmitter();
  var injector = new Injector();


  describe('#listenTo', function() {
    var sp = new SuperPipe(injector);
    var pipeline = new Pipeline(sp);
    it('should return an instance of Pipeline', function() {
      assume(pipeline.listenTo('click')).is.instanceOf(Pipeline);
    });

    it('should throw if listenFn is not a function', function() {
      assume(function() {
        pipeline.listenTo({}, 'click');
      }).throws(/^emitter has no listening funciton "on, addEventListener or addListener"/);
    });
  });

  describe('#pipe("fnName")', function() {
    var emitter = new EventEmitter();
    var injector = new Injector();
    var sp = new SuperPipe(injector);
    var pipeline = sp
      .listenTo(emitter, 'click');

    it('should accept string as first argument and get the pipe function use the value of the string and call it', function(done) {
      pipeline
        .pipe('setDep')
        .pipe(function(target) {
          assume(target).equals('x');
          done();
        }, 'target');
      emitter.emit('click', {
        target: 'x'
      });
    });

    it('should accept object as hashed dependencies', function() {
      var hashedDeps = function(obj, fn) {
        assume(obj.myFn).equals(hashedDeps);
        assume(fn).equals(hashedDeps);
      }
      sp.setDep('hashedDeps', hashedDeps)
        .listenTo(emitter, 'keydown')
        .pipe('hashedDeps', [{
          myFn: 'hashedDeps'
        }, 'hashedDeps']);
      emitter.emit('keydown');
    });
  });

  describe('#pipe(number)', function() {
    var sp = new SuperPipe(injector);
    var pipeline = sp.listenTo('fast');

    it('should throttle the events emitted', function(done) {
      var normalCounter = 0;
      var throttledCounter = 0;
      pipeline
        .pipe(function() {
          normalCounter++;
        })
        .pipe(100)
        .pipe(function() {
          throttledCounter++;
          if (throttledCounter === 2) {
            assume(normalCounter).equals(11);
            done();
          }
        });

      for (var i = 0; i < 10; i++) {
        sp.emit('fast');
      }

      setTimeout(function() {
        sp.emit('fast');
      }, 110);
    });
  });

  describe('#pipe', function() {
    function clickHandler() {
    }

    var value = 1;

    function processer(handlerFn, setDep) {
      assume(handlerFn).equals(clickHandler);
      setDep('valueFromProcesserA', value);
      value++;
      return true;
    }

    var sp = new SuperPipe(injector);
    var pipeline = sp
      .setDep('handleClick', clickHandler)
      .listenTo(emitter, 'click');

    it('should throw if fn is not a function or name of a dependency function', function() {
      assume(function() {
        pipeline.pipe({});
      }).throws(/^fn should be a function, got/);
    });

    it('should accept mutiple arguments string as dependencies', function() {
      pipeline.pipe(processer, ['handleClick', 'setDep']);
      emitter.emit('click');
    });

    it('should accept array as dependencies', function() {
      pipeline.pipe(processer, ['handleClick', 'setDep']);
      emitter.emit('click');
    });

    it('should has 0 or null as context for each pipeline functions', function() {
      pipeline.pipe(function() {
        assume(+this).equals(0)
      });
    });

    it('should keep the original argument if null is provided while still provide the right dependency need to be injected', function() {
      pipeline
        .pipe(function(event, next) {
          assume(event.target).equals('a');
          next();
        }, [null, 'next']);
      emitter.emit('click', {
        target: 'a'
      });

    });

    it('should not register getDep as a dependency', function() {
      pipeline.pipe(function(getDep) {
        assume(getDep).equals(undefined);
      }, 'getDep');
    });

    it('should register setDep as dependencies and bind with dependencies of current pipeline', function(done) {
      pipeline
        .pipe(function(setDep) {
          assume(sp.setDep).not.equals(setDep);
          sp.setDep('key', 'old value');
          setDep('key', 'new value');
        }, 'setDep')
        .pipe(function(key) {
          assume(key).equals('new value');
          assume(sp.getDep('key')).equals('old value');
          done();
        }, 'key');

      emitter.emit('click', {
        target: 'a'
      });
    });

    it('should call the piped stream functions for the correct times', function() {
      assume(value).equals(8);
    });
  });

  describe('#error', function() {
    var sp = new SuperPipe(injector);
    sp.setDep('dep1', 1);
    var pipeline = sp.listenTo(emitter, 'normal');
    var errMessage = 'Error message';
    var normalMessage = 'Normal message';

    it('should call error handler when next is called with truthy first argument', function(done) {
      pipeline
        .pipe(function(msg) {
          assume(msg).equals(normalMessage);
        })
        .pipe(function(next) {
          next(errMessage);
        }, 'next');
      pipeline.error(function(err) {
        assume(err).equals(errMessage);
        done();
      });
      emitter.emit('normal', normalMessage);
    });

    it('should call error handler with requested dependencies', function(done) {
      pipeline.error(function(err, arg1) {
        assume(err).equals(errMessage);
        assume(arg1).equals(1);
        done();
      }, [null, 'dep1']);
      emitter.emit('normal', normalMessage);
    });
  });

  describe('events', function() {
    var sp = new SuperPipe()
    it('should get `emit` as dependency and trigger the event', function(done) {
      sp
        .listenTo('eventA')
        .pipe(function(emit) {
          emit('eventB', 'data of eventB');
        }, 'emit')
      sp
        .listenTo('eventB')
        .pipe(function(data) {
          assume(data).equals('data of eventB');
          done()
        })
      sp.emit('eventA')
    });
  });
});
