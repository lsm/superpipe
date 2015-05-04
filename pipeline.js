var Injector = require('./injector');
var toArray = require('lodash.toarray');
var EventEmitter = require('eventemitter3');

module.exports = Pipeline;

function Pipeline(plumber) {
  this.plumber = plumber;
  this.injector = plumber.injector;
  this.pipes = [];
  this.emitter = new EventEmitter();
}

Pipeline.prototype = {

  trigger: function() {
    this.emitter.emit.apply(this.emitter, arguments);
    return this;
  },

  toTrigger: function(event) {
    var self = this;
    return function trigger() {
      var args = toArray(arguments);
      args.unshift(event);
      self.trigger.apply(self, args);
    };
  },

  listenTo: function(emitter, name) {
    if ('string' === typeof emitter) {
      name = emitter;
      emitter = this.emitter;
    }
    var listenFn = emitter.on;
    if ('function' !== typeof listenFn) {
      throw new Error('emitter has no listening funciton "on"');
    }
    listenFn = listenFn.bind(emitter);

    var self = this;
    var pipes = this.pipes;
    var plumber = this.plumber;

    listenFn(name, function() {
      if (pipes[0]) {
        var step = 0;
        var args = toArray(arguments);
        var injector = new Injector(self.injector);

        var setDep = plumber.setDep.bind({
          injector: injector
        });

        // global deps getter/setter for sharing states cross pipelines
        injector.regDependency('set', function() {
          plumber.setDep.apply(plumber, arguments);
          setDep.apply(null, arguments);
        });
        injector.regDependency('get', function() {
          return plumber.getDep.apply(plumber, arguments);
        });

        var ctx = {
          setDep: function() {
            setDep.apply(null, arguments);
            return ctx;
          },
          injector: injector
        };

        injector.regDependency(ctx);

        var next = function next() {
          // get the right unit from the pipes array
          var pipe = pipes[step++];
          if (pipe) {
            var fn = pipe.fn;
            var deps = pipe.deps;
            //  run the actual function
            var result = fn.apply(ctx, args);
            // check if we need to run next automatically
            if (result !== false && (!deps || (deps.indexOf('next') === -1))) {
              // no deps or has deps but next is not required
              // call next when there's a true result
              next();
            }
          }
        };

        ctx.next = next;

        ctx.error = function(error) {
          if (self.errorHandler) {
            self.errorHandler.call(ctx, error);
          } else {
            console.warn('No error handler function');
            console.error(error);
          }
        };

        // register all member of context as dependencies for this stream instance
        injector.regDependency('next', next);
        // start executing the chain
        next();
      }
    });

    return this;
  },

  pipe: function(fn, deps) {
    var injector = this.injector;
    if ('string' === typeof fn) {
      var fnName = fn;
      fn = function() {
        // @todo @note should test and catch bug like this
        var _fn = injector.getDependency(fnName);
        if ('function' === typeof _fn) {
          return _fn.apply(this, arguments);
        } else if ('boolean' === typeof _fn) {
          return _fn;
        } else {
          throw new Error('Dependency ' + fnName + ' is not a function.');
        }
      };
    }
    if (Array.isArray(fn)) {
      deps = fn.slice(1);
      fn = fn[0];
    }
    if ('function' !== typeof fn) {
      throw new Error('fn should be a function or name of registered function dependency: ' + fn);
    }

    // normalize deps to array
    if (arguments.length > 2) {
      deps = Array.prototype.slice.call(arguments, 1);
    } else if ('string' === typeof deps || (!Array.isArray(deps) && 'object' === typeof deps)) {
      deps = [deps];
    }

    if (deps && !Array.isArray(deps)) {
      throw new Error('deps should be either string or array of dependency names');
    }

    // get our injected version of pipe function
    fn = injector.inject(fn, deps, injector);

    // save to the pipes array as a pipes unit
    this.pipes.push({
      fn: fn,
      deps: deps
    });

    return this;
  },

  error: function(errorHandler) {
    if ('string' === typeof errorHandler) {
      errorHandler = this.injector.getDependency(errorHandler);
    }
    this.errorHandler = errorHandler;
    return this;
  }
};
