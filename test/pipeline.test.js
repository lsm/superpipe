'use strict';
/* globals describe, it */
var SuperPipe = require('../test_index');
var Pipeline = SuperPipe.Pipeline;
var Injector = SuperPipe.Injector;
var EventEmitter = require('events').EventEmitter;
var should = require('should');


describe('Pipeline', function() {

  var emitter = new EventEmitter();
  var injector = new Injector();


  describe('#listenTo', function() {
    var sp = new SuperPipe(injector);
    var pipeline = new Pipeline(sp);
    it('should return an instance of Pipeline', function() {
      pipeline.listenTo('click').should.be.an.instanceOf.Pipeline;
    });

    it('should throw if listenFn is not a function', function() {
      (function() {
        pipeline.listenTo({}, 'click');
      }).should.throw(/^emitter has no listening funciton "on, addEventListener or addListener"/);
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
          target.should.be.equal('x');
          done();
        }, 'target');
      emitter.emit('click', {
        target: 'x'
      });
    });

    it('should accept object as hashed dependencies', function() {
      sp.setDep('hashedDeps', function hashedDeps(obj, fn) {
          obj.myFn.should.be.equal(hashedDeps);
          fn.should.be.equal(hashedDeps);
        })
        .listenTo(emitter, 'keydown')
        .pipe('hashedDeps', {
          myFn: 'hashedDeps'
        }, 'hashedDeps');
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
            normalCounter.should.be.equal(11);
            done();
          }
        });

      for (var i = 0; i < 10; i++) {
        pipeline.trigger('fast');
      }

      setTimeout(function() {
        pipeline.trigger('fast');
      }, 110);
    });
  });

  describe('#pipe', function() {
    function clickHandler() {}

    var value = 1;

    function processer(handlerFn, setDep) {
      handlerFn.should.be.equal(clickHandler);
      setDep('valueFromProcesserA', value);
      value++;
      return true;
    }

    var sp = new SuperPipe(injector);
    var pipeline = sp
      .setDep('handleClick', clickHandler)
      .listenTo(emitter, 'click');

    it('should throw if fn is not a function or name of a dependency function', function() {
      (function() {
        pipeline.pipe({});
      }).should.throw(/^fn should be a function or name of registered function dependency/);
    });

    it('should accept mutiple arguments string as dependencies', function() {
      pipeline.pipe(processer, 'handleClick', 'setDep');
      emitter.emit('click');
    });

    it('should accept array as dependencies', function() {
      pipeline.pipe(processer, ['handleClick', 'setDep']);
      emitter.emit('click');
    });

    it('should accept array as argument', function() {
      pipeline.pipe([processer, 'handleClick', 'setDep']);
      emitter.emit('click');
    });

    it('should has `this` equal to 0', function() {
      pipeline.pipe(function() {
        should(this).be.equal(0);
      });
    });

    it('should keep the original argument if null is provided while still provide the right dependency need to be injected', function() {
      pipeline
        .pipe(function(event, next) {
          event.target.should.be.equal('a');
          next();
        }, null, 'next');
      emitter.emit('click', {
        target: 'a'
      });

    });

    it('should not register getDep as a dependency', function() {
      pipeline.pipe(function(getDep) {
        should(getDep).be.equal(undefined);
      }, 'getDep');
    });

    it('should register setDep as dependencies and bind with dependencies of current pipeline', function(done) {
      pipeline
        .pipe(function(setDep) {
          sp.setDep.should.not.be.equal(setDep);
          sp.setDep('key', 'old value');
          setDep('key', 'new value');
        }, 'setDep')
        .pipe(function(key) {
          key.should.be.equal('new value');
          sp.getDep('key').should.be.equal('old value');
          done();
        }, 'key');

      emitter.emit('click', {
        target: 'a'
      });
    });

    it('should call the piped stream functions for the correct times', function() {
      value.should.be.equal(13);
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
          msg.should.be.equal(normalMessage);
        })
        .pipe(function(next) {
          next(errMessage);
        }, 'next');
      pipeline.error(function(err) {
        err.should.be.equal(errMessage);
        done();
      });
      emitter.emit('normal', normalMessage);
    });

    it('should call error handler with requested dependencies', function(done) {
      pipeline.error(function(err, arg1) {
        err.should.be.equal(errMessage);
        arg1.should.be.equal(1);
        done();
      }, null, 'dep1');
      emitter.emit('normal', normalMessage);
    });
  });
});
