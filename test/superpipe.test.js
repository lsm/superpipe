/* globals describe, beforeEach, it*/
var SuperPipe = require('../test_index');
var should = require('should');
var Pipeline = SuperPipe.Pipeline;


describe('SuperPipe', function() {

  describe('#constructor', function() {
    it('should return an instance of SuperPipe', function() {
      var sp = new SuperPipe();
      sp.should.be.an.instanceOf.SuperPipe;
      sp.listenTo.should.be.a.Function;
      sp.setDep.should.be.a.Function;
      sp.getDep.should.be.a.Function;
    });

    it('should register function members as dependencies', function() {
      var sp = new SuperPipe();
      sp.getDep('autoBind').should.be.a.Function;
      sp.getDep('isDepNameReserved').should.be.a.Function;
    });
  });

  describe('#setDep/#getDep', function() {
    var sp;
    var depStr = 'example';
    var DepClass = function() {

    };

    DepClass.prototype = {
      x: 1,
      y: 2,
      z: 'z',
      fn1: function fn1() {

      },
      fn2: function fn2() {

      },
      _x: 10,
      _fn: function() {

      }
    };

    var depObject = new DepClass();

    beforeEach(function() {
      sp = new SuperPipe();
    });

    it('should throw if arguments signature is not recognized', function() {
      (function() {
        sp.setDep();
      }).should.throw(/^Unsupported function arguments/);
      (function() {
        sp.setDep(function() {});
      }).should.throw(/^Unsupported function arguments/);
    });

    it('should be okay to set falsity values as dependencies', function() {
      sp.setDep('name', '');
      sp.getDep('name').should.be.equal('');
      sp.setDep('name');
      should(sp.getDep('name')).be.equal(undefined);
      sp.setDep('name', null);
      should(sp.getDep('name')).be.equal(null);
      sp.setDep('name', false);
      should(sp.getDep('name')).be.equal(false);
      sp.setDep('name', 0);
      should(sp.getDep('name')).be.equal(0);
    });

    it('should throw if set dependency with reserved name', function() {
      (function() {
        sp.setDep({
          setDep: 1
        });
      }).should.throw(/The name of your dependency is reserved:/);
      sp.reservedDeps.forEach(function(reserved) {
        (function() {
          sp.setDep(reserved, {});
        }).should.throw(/The name of your dependency is reserved:/);
      });
    });

    it('should set dependency with name and value', function() {
      sp.setDep('dep1', depObject);
      should.deepEqual(depObject, sp.getDep('dep1'));
    });

    it('should override old dependency with new value', function() {
      sp.setDep('dep1', depObject);
      sp.setDep('dep1', depStr);
      sp.getDep('dep1').should.be.equal(depStr);
    });

    it('should accept object and add all properties as dependencies', function() {
      var obj = {
        a: 'a',
        b: 2
      };
      sp.setDep(obj);
      sp.getDep('a').should.be.equal(obj.a);
      sp.getDep('b').should.be.equal(obj.b);
    });

    it('should add all properties except functions as dependencies if props is *$', function() {
      sp.setDep(depObject, '*$');
      sp.getDep('x').should.be.equal(depObject.x);
      sp.getDep('y').should.be.equal(depObject.y);
      sp.getDep('z').should.be.equal(depObject.z);
      should.not.exist(sp.getDep('fn1'));
      should.not.exist(sp.getDep('fn2'));
    });

    it('should add all functions as dependencies if props is *^', function() {
      sp.setDep(depObject, '*^');
      sp.getDep('fn1').should.be.equal(depObject.fn1);
      sp.getDep('fn2').should.be.equal(depObject.fn2);
      should.not.exist(sp.getDep('x'));
      should.not.exist(sp.getDep('y'));
      should.not.exist(sp.getDep('z'));
    });

    it('should use name as prefix', function() {
      sp.setDep('prefix', depObject, '*^');
      sp.getDep('prefix:fn1').should.be.equal(depObject.fn1);
      sp.getDep('prefix:fn2').should.be.equal(depObject.fn2);
      should.not.exist(sp.getDep('prefix:x'));
      should.not.exist(sp.getDep('prefix:y'));
      should.not.exist(sp.getDep('prefix:z'));
    });

    it('should add all properties as dependencies if props is *', function() {
      sp.setDep('name', depObject, '*');
      sp.getDep('name:x').should.be.equal(depObject.x);
      sp.getDep('name:y').should.be.equal(depObject.y);
      sp.getDep('name:z').should.be.equal(depObject.z);
      sp.getDep('name:fn1').should.be.equal(depObject.fn1);
      sp.getDep('name:fn2').should.be.equal(depObject.fn2);

    });

    it('should not register dependencies start with _ when props is any of */*$/*^', function() {
      sp.setDep('name', depObject, '*');
      should(sp.getDep('_x')).be.equal(undefined);
      should(sp.getDep('_fn')).be.equal(undefined);

      sp = new SuperPipe();
      sp.setDep('name', depObject, '*^');
      should(sp.getDep('_fn')).be.equal(undefined);

      sp = new SuperPipe();
      sp.setDep('name', depObject, '*$');
      should(sp.getDep('_x')).be.equal(undefined);
    });


  });

  describe('#autoBind', function() {
    it('should bind the right context to function dependencies when autoBind is true', function(done) {
      var sp = new SuperPipe();
      var context = {
        fn1: function() {
          this.should.be.equal(context);
          this.fn1Called = true;
        },
        fn2: function() {
          context.fn1Called.should.be.equal(true);
          this.should.not.be.equal(context);
          done();
        }
      };
      sp.autoBind(true);
      sp.setDep(context, '*^');
      sp.getDep('fn1').call({});

      sp.autoBind(false);
      sp.setDep(context, '*^');
      sp.getDep('fn2').call({});
    });
  });

  describe('#pipeline', function() {
    var sp = new SuperPipe();
    it('should return an instance of Pipeline', function() {
      sp.pipeline().should.be.an.instanceOf(Pipeline);
    });
  });

  describe('#listenTo', function() {
    var sp = new SuperPipe();
    it('should return an instance of Pipeline', function() {
      sp.listenTo('click').should.be.an.instanceOf(Pipeline);
    });
  });

});
