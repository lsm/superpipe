/* globals describe, it */
import { expect } from 'chai'
import superpipe from '../src'

describe('Pipe', function() {
  let sp = superpipe()

  describe('Exceptions', function() {
    it('should throw if type of pipe is unsupported', function() {
      expect(function() {
        sp('throw unsupported pipe').pipe(1)
      }).to.throw('Unsupported pipe function type')
      expect(function() {
        sp('throw unsupported pipe').pipe()
      }).to.throw('Unsupported pipe function type')
    })

    it('should throw if input pipe has no arguments', function() {
      expect(function() {
        sp('throw empty input').input()
      }).to.throw('"input" is required for')
    })

    it('should throw if pipe input is not non-empty string or array of non-empty strings', function() {
      expect(function() {
        sp('throw wrong input type').pipe(
          'abc',
          1
        )
      }).to.throw(
        'Pipe requires non-empty string or array of non-empty strings as input.'
      )
      expect(function() {
        sp('throw wrong input type').pipe(
          'abc',
          function() {}
        )
      }).to.throw(
        'Pipe requires non-empty string or array of non-empty strings as input.'
      )
      expect(function() {
        sp('throw wrong input type').pipe(
          'abc',
          ''
        )
      }).to.throw(
        'Pipe requires non-empty string or array of non-empty strings as input.'
      )
      expect(function() {
        sp('throw wrong input type').pipe(
          'abc',
          ['xyz', '']
        )
      }).to.throw(
        'Pipe requires non-empty string or array of non-empty strings as input.'
      )
    })

    it('should throw if pipe output is not non-empty string or array of non-empty strings', function() {
      expect(function() {
        sp('throw wrong input type').pipe(
          'abc',
          null,
          1
        )
      }).to.throw(
        'Pipe requires non-empty string or array of non-empty strings as output.'
      )
      expect(function() {
        sp('throw wrong output type').pipe(
          'abc',
          null,
          function() {}
        )
      }).to.throw(
        'Pipe requires non-empty string or array of non-empty strings as output.'
      )
      expect(function() {
        sp('throw wrong output type').pipe(
          'abc',
          null,
          ''
        )
      }).to.throw(
        'Pipe requires non-empty string or array of non-empty strings as output.'
      )
      expect(function() {
        sp('throw wrong output type').pipe(
          'abc',
          null,
          [('xyz', '')]
        )
      }).to.throw(
        'Pipe requires non-empty string or array of non-empty strings as output.'
      )
    })

    it('should throw if error handler is not string or function', function() {
      expect(function() {
        sp('throw wrong error handler type').error(1)
      }).to.throw('Error handler must be a string or function')
      expect(function() {
        sp('throw wrong error handler type').error(null)
      }).to.throw('Error handler must be a string or function')
      expect(function() {
        sp('throw wrong error handler type').error({})
      }).to.throw('Error handler must be a string or function')
    })

    it('should throw if output key is not defined in the pipe', function() {
      expect(function() {
        sp('throw undefined key')
          .pipe(
            function() {
              return { xyz: '123' }
            },
            null,
            ['abc']
          )
          .end()()
      }).to.throw('Dependency "xyz" is not defined in output.')

      expect(function() {
        sp('throw undefined key')
          .pipe(
            function(next) {
              next(null, { xyz: '123' })
            },
            'next',
            ['abc']
          )
          .end()()
      }).to.throw('Dependency "xyz" is not defined in output.')

      expect(function() {
        sp('throw undefined key')
          .pipe(
            function(set) {
              set({ abc: 'abc', xyz: '123' })
            },
            ['set'],
            ['abc']
          )
          .pipe(function() {
            throw new Error('This pipeline should not be called.')
          })
          .end()()
      }).to.throw('Dependency "xyz" is not defined in output.')
    })

    it('should throw if injected pipe is not a function', function() {
      expect(function() {
        sp('throw undefined key')
          .pipe(
            'input',
            ['func1']
          )
          .pipe('func1')
          .end()('abc')
      }).to.throw('Dependency "func1" is not a function or boolean.')
    })

    it('should throw if call set with unsupported key types', function() {
      expect(function() {
        sp('throw unsupported key')
          .pipe(
            function(set) {
              set(true, 'value')
            },
            ['set'],
            ['abc']
          )
          .end()()
      }).to.throw('Unsupported output key type.')

      expect(function() {
        sp('throw unsupported key')
          .pipe(
            function(set) {
              set(() => {}, 'value')
            },
            ['set'],
            ['abc']
          )
          .end()()
      }).to.throw('Unsupported output key type.')

      expect(function() {
        sp('throw unsupported key')
          .pipe(
            function(set) {
              set(1, 'value')
            },
            ['set'],
            ['abc']
          )
          .end()()
      }).to.throw('Unsupported output key type.')
    })
  })

  describe('Input pipes', function() {
    let sp = superpipe()
    let arg1 = 'value1'
    let arg2 = 'value2'
    it('should map positioned arguments to named depenencies', function() {
      function testFn(key2, key1) {
        expect(key1).to.equal(arg1)
        expect(key2).to.equal(arg2)
      }
      let pipeline = sp('map input')
        .input(['arg1', 'arg2'])
        .pipe(
          'input',
          ['arg3', 'arg4', 'testFn']
        )
        .pipe(
          testFn,
          ['arg2', 'arg1']
        )
        .pipe(
          'testFn',
          ['arg4', 'arg3']
        )
        .end()
      pipeline(arg1, arg2, testFn)
    })

    it('should get original arguments if no input is defined', function() {
      sp('get original')
        .pipe(function(key1, key2) {
          expect(key1).to.equal(arg1)
          expect(key2).to.equal(arg2)
        })
        .end()(arg1, arg2)
    })
  })

  describe('Boolean pipes', function() {
    let sp = superpipe({
      arg1: 'arg1 value',
      func1: true,
      func2: function(arg1) {
        return arg1 === 'arg1 value'
      }
    })

    it('should continue to next pipe if injected function is true', function(done) {
      let pl = sp('boolean value function')
        .pipe('func1')
        .pipe(done)
        .end()
      pl()
    })

    it('should continue to next pipe if injected function returns true', function(done) {
      let pl = sp('boolean value function')
        .pipe(
          'func2',
          'arg1'
        )
        .pipe(done)
        .end()
      pl()
    })
  })

  describe('Not pipes', function() {
    let sp = superpipe({
      arg1: 'arg1 value',
      func1: false,
      func2: function(arg1) {
        expect(arg1).to.equal('arg1 value')
        return arg1 === 'something else'
      }
    })

    it('should continue to next pipe if injected function is false', function(done) {
      let pl = sp('boolean value function')
        .pipe('!func1')
        .pipe(done)
        .end()
      pl()
    })

    it('should continue to next pipe if injected function returns false', function(done) {
      let pl = sp('boolean value function')
        .pipe(
          '!func2',
          'arg1'
        )
        .pipe(done)
        .end()
      pl()
    })
  })

  describe('Optional pipes', function() {
    // Create pipeline constructor with dependencies.
    let sp = superpipe({
      arg1: 'arg1 value',
      func1: function(arg1) {
        expect(arg1).to.equal('arg1 value')
        return {
          arg2: 'arg2 value'
        }
      },
      func2: function() {
        throw new Error('This function should be never called')
      }
    })

    it('should bypass optional pipes when dependencies are not satisfied', function(done) {
      function func3(arg2) {
        expect(arg2).to.equal('arg2 value')
        done()
      }

      let pl = sp('optional pipes')
        .input('func3')
        .pipe(
          'func1',
          'arg1',
          'arg2'
        )
        .pipe(
          '?missingFunction',
          'arg2'
        )
        .pipe(
          '?func2',
          'no such argument'
        )
        .pipe(
          'func3',
          'arg2'
        )
        .end()

      pl(func3)
    })
  })

  describe('Mapping output', function() {
    let sp = superpipe({
      arg1: 'arg1 value',
      func1: function(arg1) {
        expect(arg1).to.equal('arg1 value')
        return {
          arg2: 'arg2 value'
        }
      },
      func2: function(arg2) {
        expect(arg2).to.equal('arg2 value')
      },
      func3: function(set) {
        set('arg2', 'arg2 value')
      }
    })

    it('should map the returned output to new name', function() {
      let pl = sp('map output')
        .pipe(
          'func1',
          'arg1',
          'arg2:mappedArgName'
        )
        .pipe(
          'func2',
          'mappedArgName'
        )
        .end()
      pl()
    })

    it('should map the setted output to new name', function() {
      let pl = sp('set map output')
        .pipe(
          'func3',
          'set',
          'arg2:mappedArgName'
        )
        .pipe(
          'func2',
          'mappedArgName'
        )
        .end()
      pl()
    })
  })
})
