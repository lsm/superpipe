/* globals describe, it */
import { expect } from 'chai'
import superpipe from '../src'

describe('Execution', function() {
  const sp = superpipe()

  describe('Auto next', function() {
    it('should go to next pipe when returned value is not false', function(done) {
      sp('true triggers auto next')
        .pipe(function() {
          return true
        })
        .pipe(function() {
          return 1
        })
        .pipe(function() {
          return null
        })
        .pipe(function() {
          return undefined
        })
        .pipe(function() {
          return ''
        })
        .pipe(function() {
          return []
        })
        .pipe(function() {
          return {}
        })
        .pipe(function() {
          return function() {}
        })
        .pipe(done)
        .end()()
    })

    it('should not go to next pipe when false is returned', function() {
      let pl = sp('false will not trigger auto next')
        .pipe(function() {
          return false
        })
        .pipe(() => {
          throw new Error('This function should not be called')
        })
        .end()
      pl()
    })

    it('should go to next pipe when plain object is returned', function(done) {
      let pl = sp('object triggers auto next')
        .pipe(
          function() {
            return {
              abc: 123,
              xyz: 456
            }
          },
          null,
          ['abc', 'xyz']
        )
        .pipe(
          function(abc, xyz) {
            expect(abc).to.equal(123)
            expect(xyz).to.equal(456)
          },
          ['abc', 'xyz']
        )
        .pipe(
          function() {
            return {
              arg1: 'arg1 value'
            }
          },
          null,
          ['arg1', 'arg2']
        )
        .pipe(
          (arg1, arg2) => {
            expect(arg1).to.equal('arg1 value')
            expect(arg2).to.equal(undefined)
          },
          ['arg1', 'arg2']
        )
        .pipe(done)
        .end()
      pl()
    })
  })

  describe('Manual next', function() {
    it('should go to next pipe only after next is called', function(done) {
      let nextCalled = false
      let pl = sp('next is in control')
        .pipe(
          function(next) {
            setTimeout(function() {
              nextCalled = true
              next()
            }, 20)
            return true
          },
          'next'
        )
        .pipe(() => {
          expect(nextCalled).to.equal(true)
          nextCalled = false
        })
        .pipe(
          function(next) {
            expect(nextCalled).to.equal(false)
            setTimeout(() => {
              nextCalled = true
              next(null, { abc: 123, xyz: 456 })
            }, 40)
          },
          'next',
          ['abc', 'xyz']
        )
        .pipe(
          function(abc, xyz) {
            expect(abc).to.equal(123)
            expect(xyz).to.equal(456)
            expect(nextCalled).to.equal(true)
            done()
          },
          ['abc', 'xyz']
        )
        .end()
      pl()
    })

    it('should pass output via next with array value', function(done) {
      let pl = sp('next with array value')
        .pipe(
          function(next) {
            setTimeout(function() {
              next(null, [123, 456])
            }, 50)
          },
          'next',
          ['abc', 'xyz']
        )
        .pipe(
          function(abc, xyz) {
            expect(abc).to.equal(123)
            expect(xyz).to.equal(456)
            done()
          },
          ['abc', 'xyz']
        )
        .end()
      pl()
    })

    it('should pass single output via next', function(done) {
      let pl = sp('next with single value')
        .pipe(
          function(next) {
            setTimeout(function() {
              next(null, 'single value')
            }, 50)
          },
          'next',
          'result'
        )
        .pipe(
          function(result) {
            expect(result).to.equal('single value')
            done()
          },
          'result'
        )
        .end()
      pl()
    })

    it('should not map primitive value when multiple outputs declared', function(done) {
      let pl = sp('primitive with multiple outputs')
        .pipe(
          function(next) {
            // Return a number (not array, not object) with multiple outputs
            next(null, 42)
          },
          'next',
          ['abc', 'xyz']
        )
        .pipe(
          function(abc, xyz) {
            // Neither should be set since value is primitive
            expect(abc).to.equal(undefined)
            expect(xyz).to.equal(undefined)
            done()
          },
          ['abc', 'xyz']
        )
        .end()
      pl()
    })

    it('should handle null value with no output defined', function(done) {
      let pl = sp('null value no output')
        .pipe(
          function(next) {
            // Return null - tests isPlainObject with null
            next(null, null)
          },
          'next'
        )
        .pipe(done)
        .end()
      pl()
    })

    it('should not merge array when no output defined', function(done) {
      let pl = sp('array with no output')
        .pipe(
          function(next) {
            // Return an array with no output defined - should not merge
            next(null, [1, 2, 3])
          },
          'next'
        )
        .pipe(done)
        .end()
      pl()
    })

    it('should not merge string when no output defined', function(done) {
      let pl = sp('string with no output')
        .pipe(
          function(next) {
            // Return a string with no output defined - should not merge
            next(null, 'test string')
          },
          'next'
        )
        .pipe(done)
        .end()
      pl()
    })

    it('should not merge number when no output defined', function(done) {
      let verifyResult = false
      let pl = sp('number with no output')
        .pipe(
          function(next) {
            // Return a number - primitive, not object, not array
            next(null, 12345)
          },
          'next'
        )
        .pipe(
          function(result) {
            // The number should NOT be merged into store (result is undefined)
            expect(result).to.equal(undefined)
            verifyResult = true
          },
          'result'
        )
        .pipe(function() {
          expect(verifyResult).to.equal(true)
          done()
        })
        .end()
      pl()
    })
  })
})
