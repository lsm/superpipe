/* globals describe, it */
import { expect } from 'chai'
import superpipe from '../src'

describe('Exceptions', function() {
  let sp = superpipe()

  describe('pipe', function() {
    it('should throw if type of pipe is unsupported', function() {
      expect(function() {
        sp('throw unsupported pipe').pipe(1)
      }).to.throw('Unsupported pipe function type')
      expect(function() {
        sp('throw unsupported pipe').pipe()
      }).to.throw('Unsupported pipe function type')
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

      expect(function() {
        sp('throw undefined key')
          .pipe(
            'input',
            ['func1']
          )
          .pipe('func1')
          .end()(1)
      }).to.throw('Dependency "func1" is not a function or boolean.')

      expect(function() {
        sp('throw undefined key')
          .pipe(
            'input',
            ['func1']
          )
          .pipe('func1')
          .end()({})
      }).to.throw('Dependency "func1" is not a function or boolean.')
    })
  })

  describe('input', function() {
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
  })

  describe('output', function() {
    it('should throw if pipe output is not non-empty string or array of non-empty strings', function() {
      expect(function() {
        sp('throw wrong output type').pipe(
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
  })

  describe('error', function() {
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
  })

  describe('set', function() {
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

  describe('next', function() {
    it('should throw if next was called more than once in a pipe', function() {
      expect(function() {
        sp('call next twice')
          .pipe(
            function(next) {
              next()
              next()
            },
            'next'
          )
          .end()()
      }).to.throw('"next" should not be called more than once in a pipe.')
    })
  })
})
