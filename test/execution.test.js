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
          function(set, next) {
            expect(nextCalled).to.equal(false)
            set('abc', 123)
            setTimeout(() => {
              set('xyz', 456)
            }, 20)
            setTimeout(() => {
              nextCalled = true
              next()
            }, 40)
          },
          ['set', 'next'],
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

    it('should trigger next only when all outputs haven been fulfilled', function(done) {
      let setCalled = false
      let pl = sp('set is in control')
        .pipe(
          function(set) {
            set('abc', 123)
            setTimeout(function() {
              setCalled = true
              set('abc', 789) // Repeat calls to set for the same key should override the old value.
              set('xyz', 456)
            }, 50)
            return true
          },
          'set',
          ['abc', 'xyz']
        )
        .pipe(
          function(abc, xyz) {
            expect(setCalled).to.equal(true)
            expect(abc).to.equal(789)
            expect(xyz).to.equal(456)
            done()
          },
          ['abc', 'xyz']
        )
        .end()
      pl()
    })

    it('should go next when all outputs has been fulfilled even the value is undefined', function(done) {
      let setCalled = false
      let pl = sp('set is in control')
        .pipe(
          function(set) {
            set('abc', 123)
            setTimeout(function() {
              setCalled = true
              set('xyz', undefined)
            }, 50)
            return true
          },
          'set',
          ['abc', 'xyz']
        )
        .pipe(
          function(abc, xyz) {
            expect(setCalled).to.equal(true)
            expect(abc).to.equal(123)
            expect(xyz).to.equal(undefined)
            done()
          },
          ['abc', 'xyz']
        )
        .end()
      pl()
    })
  })
})
