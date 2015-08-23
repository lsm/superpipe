/* globals describe, beforeEach, it*/
var Plumber = require('../');
var should = require('should');
var Pipeline = Plumber.Pipeline;


describe('Plumber', function() {

  describe('#constructor', function() {
    it('should return an instance of Plumber', function() {
      var plumber = new Plumber();
      plumber.should.be.an.instanceOf.Plumber;
      plumber.listenTo.should.be.a.Function;
      plumber.setDep.should.be.a.Function;
      plumber.getDep.should.be.a.Function;
    });

    it('should register function members as dependencies', function() {
      var plumber = new Plumber();
      plumber.getDep('autoBind').should.be.a.Function;
      plumber.getDep('isDepNameReserved').should.be.a.Function;
    });
  });

  describe('#setDep/#getDep', function() {
    var plumber;
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
      plumber = new Plumber();
    });

    it('should throw if arguments signature is not recognized', function() {
      (function() {
        plumber.setDep();
      }).should.throw(/^Unsupported function arguments/);
      (function() {
        plumber.setDep(function() {});
      }).should.throw(/^Unsupported function arguments/);
    });

    it('should be okay to set falsity values as dependencies', function() {
      plumber.setDep('name', '');
      plumber.getDep('name').should.be.equal('');
      plumber.setDep('name');
      should(plumber.getDep('name')).be.equal(undefined);
      plumber.setDep('name', null);
      should(plumber.getDep('name')).be.equal(null);
      plumber.setDep('name', false);
      should(plumber.getDep('name')).be.equal(false);
      plumber.setDep('name', 0);
      should(plumber.getDep('name')).be.equal(0);
    });

    it('should throw if set dependency with reserved name', function() {
      (function() {
        plumber.setDep({
          setDep: 1
        });
      }).should.throw(/The name of your dependency is reserved:/);
      plumber.reservedDeps.forEach(function(reserved) {
        (function() {
          plumber.setDep(reserved, {});
        }).should.throw(/The name of your dependency is reserved:/);
      });
    });

    it('should set dependency with name and value', function() {
      plumber.setDep('dep1', depObject);
      should.deepEqual(depObject, plumber.getDep('dep1'));
    });

    it('should override old dependency with new value', function() {
      plumber.setDep('dep1', depObject);
      plumber.setDep('dep1', depStr);
      plumber.getDep('dep1').should.be.equal(depStr);
    });

    it('should accept object and add all properties as dependencies', function() {
      var obj = {
        a: 'a',
        b: 2
      };
      plumber.setDep(obj);
      plumber.getDep('a').should.be.equal(obj.a);
      plumber.getDep('b').should.be.equal(obj.b);
    });

    it('should add all properties except functions as dependencies if props is *$', function() {
      plumber.setDep(depObject, '*$');
      plumber.getDep('x').should.be.equal(depObject.x);
      plumber.getDep('y').should.be.equal(depObject.y);
      plumber.getDep('z').should.be.equal(depObject.z);
      should.not.exist(plumber.getDep('fn1'));
      should.not.exist(plumber.getDep('fn2'));
    });

    it('should add all functions as dependencies if props is *^', function() {
      plumber.setDep(depObject, '*^');
      plumber.getDep('fn1').should.be.equal(depObject.fn1);
      plumber.getDep('fn2').should.be.equal(depObject.fn2);
      should.not.exist(plumber.getDep('x'));
      should.not.exist(plumber.getDep('y'));
      should.not.exist(plumber.getDep('z'));
    });

    it('should use name as prefix', function() {
      plumber.setDep('prefix', depObject, '*^');
      plumber.getDep('prefix:fn1').should.be.equal(depObject.fn1);
      plumber.getDep('prefix:fn2').should.be.equal(depObject.fn2);
      should.not.exist(plumber.getDep('prefix:x'));
      should.not.exist(plumber.getDep('prefix:y'));
      should.not.exist(plumber.getDep('prefix:z'));
    });

    it('should add all properties as dependencies if props is *', function() {
      plumber.setDep('name', depObject, '*');
      plumber.getDep('name:x').should.be.equal(depObject.x);
      plumber.getDep('name:y').should.be.equal(depObject.y);
      plumber.getDep('name:z').should.be.equal(depObject.z);
      plumber.getDep('name:fn1').should.be.equal(depObject.fn1);
      plumber.getDep('name:fn2').should.be.equal(depObject.fn2);

    });

    it('should not register dependencies start with _ when props is any of */*$/*^', function() {
      plumber.setDep('name', depObject, '*');
      should(plumber.getDep('_x')).be.equal(undefined);
      should(plumber.getDep('_fn')).be.equal(undefined);

      plumber = new Plumber();
      plumber.setDep('name', depObject, '*^');
      should(plumber.getDep('_fn')).be.equal(undefined);

      plumber = new Plumber();
      plumber.setDep('name', depObject, '*$');
      should(plumber.getDep('_x')).be.equal(undefined);
    });


  });

  describe('#autoBind', function() {
    it('should bind the right context to function dependencies when autoBind is true', function(done) {
      var plumber = new Plumber();
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
      plumber.autoBind(true);
      plumber.setDep(context, '*^');
      plumber.getDep('fn1').call({});

      plumber.autoBind(false);
      plumber.setDep(context, '*^');
      plumber.getDep('fn2').call({});
    });
  });

  describe('#pipefy', function() {
    var plumber = new Plumber();
    it('should return an instance of Pipeline', function() {
      plumber.pipefy().should.be.an.instanceOf(Pipeline);
    });
  });

  describe('#listenTo', function() {
    var plumber = new Plumber();
    it('should return an instance of Pipeline', function() {
      plumber.listenTo('click').should.be.an.instanceOf(Pipeline);
    });
  });

});
