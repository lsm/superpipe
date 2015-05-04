/* globals describe, it */
var Plumber = require('../plumber');
var Pipeline = require('../pipeline');
var Injector = require('../injector');
var EventEmitter = require('events').EventEmitter;
var should = require('should');


describe('Pipeline', function() {

  var emitter = new EventEmitter();
  var injector = new Injector();


  describe('#listenTo', function() {
    var plumber = new Plumber(injector);
    var pipeline = new Pipeline(plumber);
    it('should return an instance of Pipeline', function() {
      pipeline.listenTo('click').should.be.an.instanceOf.Pipeline;
    });

    it('should throw if listenFn is not a function', function() {
      (function() {
        pipeline.listenTo({}, 'click');
      }).should.throw(/^emitter has no listening funciton "on"/);
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

    var plumber = new Plumber(injector);
    var pipeline = plumber
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

    it('should not register getDep as a dependency', function () {
      pipeline.pipe(function (getDep) {
        should(getDep).be.equal(undefined);
      }, 'getDep');
    });

    it('should register setDep as dependencies and bind with dependencies of current pipeline', function(done) {
      pipeline
        .pipe(function (setDep) {
          plumber.setDep.should.not.be.equal(setDep);
          plumber.setDep('key', 'old value');
          setDep('key', 'new value');
        }, 'setDep')
        .pipe(function(key) {
          key.should.be.equal('new value');
          plumber.getDep('key').should.be.equal('old value');
          done();
        }, 'key');

      emitter.emit('click', {
        target: 'a'
      });
    });

    it('should call the piped stream functions for the correct times', function() {
      value.should.be.equal(13);
    });

    it('should accept object as hashed dependencies', function() {
      plumber.setDep('hashedDeps', function hashedDeps(obj, fn) {
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
});
