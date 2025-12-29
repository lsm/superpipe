/* globals describe, it */
import { expect } from 'chai'
import superpipe from '../src'

describe('Pipeline', function() {
  describe('Declarative API', function() {
    // Create pipeline constructor with dependencies.
    let sp = superpipe({
      arg1: 'arg1 value',
      func1: function(arg1) {
        expect(arg1).to.equal('arg1 value')
        return {
          arg2: 'arg2 value'
        }
      }
    })

    it('should build the pipeline from the definition and end the pipeline', function(done) {
      function func2(arg2) {
        expect(arg2).to.equal('arg2 value')
        done()
      }
      let pl = sp('DeclarativePipeline', [
        ['input', 'func2'],
        ['func1', 'arg1', 'arg2'],
        ['func2', 'arg2']
      ])

      expect(pl).to.be.a('function')
      pl(func2)
    })
  })

  describe('Error handling', function() {
    let sp = superpipe({
      arg1: 'arg1 value',
      func1: function(arg1) {
        expect(arg1).to.equal('arg1 value')
        return {
          arg2: 'arg2 value'
        }
      },
      triggerError: function(arg2, next) {
        expect(arg2).to.equal('arg2 value')
        next('some error', {
          arg3: 'arg3 value'
        })
      }
    })

    it('should handle error using the error handler', function(done) {
      function handleError(error, arg1, arg2, arg3) {
        expect(error).to.equal('some error')
        expect(arg1).to.equal('arg1 value')
        expect(arg2).to.equal('arg2 value')
        expect(arg3).to.equal('arg3 value')
        done()
      }
      let pl = sp('test error handling')
        .input('handleError')
        .pipe(
          'func1',
          'arg1',
          'arg2'
        )
        .pipe(
          'triggerError',
          ['arg2', 'next'],
          'arg3'
        )
        .error('handleError', ['error', 'arg1', 'arg2', 'arg3'])
        .end()

      pl(handleError)
    })

    it('should throw if error is triggered but no error handler is provided', function() {
      let pl = sp('trigger error directly')
        .pipe(
          'func1',
          'arg1',
          'arg2'
        )
        .pipe(
          'triggerError',
          ['arg2', 'next'],
          'arg3'
        )
        .end()
      expect(pl).to.throw('some error')
    })

    it('should not call next pipe when error accured', function() {
      let pl = sp('trigger with error object')
        .pipe(
          'func1',
          'arg1',
          'arg2'
        )
        .pipe(
          function(arg2, next) {
            expect(arg2).to.equal('arg2 value')
            next(new TypeError('a type error'), {
              arg3: 'arg3 value'
            })
          },
          ['arg2', 'next'],
          'arg3'
        )
        .pipe(function() {
          throw new Error('This pipeline should not be called')
        })
        .end()

      expect(pl).to.throw(TypeError, 'a type error')
    })

    it('should throw if we set error handler twice', function() {
      expect(function() {
        sp('set multiple error handler')
          .error('errorHandler1')
          .error('errorHandler2')
      }).to.throw('Each pipeline could only have one error handler.')

      expect(function() {
        sp('set multiple error handler', [
          ['error', 'errorHandler2'],
          ['error', 'errorHandler1']
        ])
      }).to.throw('Each pipeline could only have one error handler.')
    })

    it('should handle error using function as error handler', function(done) {
      let pl = sp('error handler as function')
        .pipe(
          function(next) {
            next('error occurred')
          },
          'next'
        )
        .error(function(error) {
          expect(error).to.equal('error occurred')
          done()
        }, 'error')
        .end()
      pl()
    })

    it('should ignore next calls from error handler after error is handled', function(done) {
      let errorHandlerCalled = false
      let pl = sp('ignore next from error handler')
        .pipe(
          function(next) {
            next('first error')
          },
          'next'
        )
        .pipe(function() {
          throw new Error('This pipe should not be called')
        })
        .error(function(error, next) {
          expect(error).to.equal('first error')
          errorHandlerCalled = true
          // Call next from error handler - should be ignored since error was already handled
          next()
          done()
        }, ['error', 'next'])
        .end()
      pl()
    })
  })
})
