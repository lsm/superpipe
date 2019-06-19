import { expect } from 'chai'
import superpipe from '../../src'
import { describe, it } from 'mocha'

describe('Executor', () => {
  const input = {
    arg1: 'a',
    arg2: 1,
  }

  const output = {
    key1: 'value of key1',
    key2: { subkey: 'value of subkey' },
    key3: [ 'value in array' ],
    key4: function () { return 'value of key4' },
    key5: {},
  }

  const dependencies = {
    arrayInput:
      function (arg2, arg1) {
        expect(arg1).to.equal(input.arg1)
        expect(arg2).to.equal(input.arg2)
      },
  }

  const sp = superpipe(dependencies)

  describe('Test input/output', () => {
    it('should get inputs correctly', () => {
      const pl = sp('test input')

      expect(pl.name).to.equal('test input')

      function singleInput (arg2) {
        expect(arg2).to.equal(input.arg2)
      }

      function objectStringInput ({ arg2, arg1 }) {
        expect(arg1).to.equal(input.arg1)
        expect(arg2).to.equal(input.arg2)
      }

      const func = pl
        .input('{arg1, arg2}')
        .pipe('arrayInput', [ 'arg2', 'arg1' ])
        .pipe(singleInput, 'arg2')
        .pipe(objectStringInput, '{arg1, arg2}')
        .end('arg2')

      const result = func(input)
      expect(result).to.equal(input.arg2)
    })

    it('should produce outputs correctly', () => {
      const pl = sp('test output')

      expect(pl.name).to.equal('test output')

      function outputObject () {
        return {
          renamedKey3: output.key3,
          renamedKey2: output.key2,
          key4: output.key4,
        }
      }

      function outputArray () {
        return [ output.key2, output.key1, outputObject ]
      }

      function outputSingle () {
        return output.key3
      }

      const func = pl
        .pipe(outputArray, null, [ 'key2', 'key1', 'outputObject' ])
        .pipe(outputSingle, null, 'key3')
        .pipe('outputObject', null, '{renamedKey2, renamedKey3}')
        .end('{key1, key2, key3, renamedKey3, renamedKey2, key4}')

      const result = func()

      expect(result.key1).to.equal(result.key1)
      expect(result.key2).to.deep.equal(result.key2)
      expect(result.key3).to.deep.equal(result.key3)
      expect(result.renamedKey2).to.deep.equal(result.key2)
      expect(result.renamedKey3).to.deep.equal(result.key3)
      expect(result.key4).to.equal(undefined)
    })
  })

  describe('Test async pipes', () => {
    it('should control the execution of the pipeline by calling next', (done) => {
      const asyncFunc1 = function (arg1, next) {
        setTimeout(function () {
          expect(arg1).to.equal(input.arg1)
          next(null, { key1: output.key1 })
        }, 75)
      }

      const asyncFunc2 = function ({ arg2, next }) {
        setTimeout(function () {
          expect(arg2).to.equal(input.arg2)
          next(null, [ output.key2, output.key4, output.key5 ])
        }, 50)
      }

      const asyncFunc3 = function (next) {
        setTimeout(function () {
          next(null, output.key3)
        }, 50)
      }

      const verifyResult = function (key2, key1, key5, key3, key4) {
        expect(key1).to.deep.equal(output.key1)
        expect(key2).to.deep.equal(output.key2)
        expect(key3).to.deep.equal(output.key3)
        expect(key4).to.deep.equal(output.key4)
        expect(key5).to.deep.equal(undefined)
        done()
      }

      const func = sp('test async pipes')
        .input('{arg1, arg2}')
        .pipe(asyncFunc1, [ 'arg1', 'next' ], '{key1}')
        .pipe(asyncFunc2, '{arg2, next}', [ 'key2', 'key4' ])
        .pipe(asyncFunc3, 'next', 'key3')
        .pipe(verifyResult, [ 'key2', 'key1', 'key5', 'key3', 'key4' ])
        .end([ 'key2', 'key1', 'key5', 'key3', 'key4' ])

      const result = func(input)
      expect(typeof result).to.equal('object')
      expect(Object.keys(result).length).to.equal(5) // five undefineds
    })

    it('should not invoke next pipe if next is not called', () => {
      const func = sp()
        .pipe(function () {}, 'next')
        .pipe(function () { throw new Error('This pipe should never be called') })
        .end()

      func()
    })
  })

  describe('Test optional pipe', () => {
    it('should ignore the optional pipe if it is not provided', (done) => {
      const func = sp('call optional pipe')
        .input([ 'someFunc', 'arg2' ])
        .pipe('someFunc?', 'arg2')
        .end()

      const func2 = sp('ignore optional pipe')
        .pipe('someFunc?', 'arg2')
        .pipe(() => func(someFunc, input.arg2))
        .end()

      function someFunc (arg2) {
        expect(arg2).to.equal(input.arg2)
        done()
      }

      func2()
    })
  })

  describe('Test error handling', () => {
    it('should trigger error when pipe function throws', (done) => {
      let error
      const func = sp('test sync error')
        .pipe(() => {
          error = new Error('error message')
          error.data = output.key5
          throw error
        }, null, [ 'abc' ])
        .error(function (err, abc) {
          expect(err).to.equal(error)
          expect(err.data).to.equal(output.key5)
          expect(abc).to.equal(undefined)
          done()
        }, [ 'error', 'abc' ])
        .end()

      func()
    })

    it('should trigger error when calling next with error', (done) => {
      const asyncErrorFunc = function (next) {
        setTimeout(function () {
          next(output.key4)
        }, 50)
      }
      const func = sp('test async error')
        .pipe(asyncErrorFunc, [ 'next' ])
        .error(function (error) {
          expect(error).to.equal(output.key4)
          done()
        })
        .end()

      func()
    })

    it('should trigger error with result', (done) => {
      const asyncErrorFunc = function (next) {
        setTimeout(function () {
          next(output.key4, { key1: output.key1 })
        }, 50)
      }
      const errorHandler = function ({ error, key1, key2 }) {
        expect(error).to.equal(output.key4)
        expect(key1).to.equal(output.key1)
        expect(key2).to.equal(undefined)
        done()
      }

      const func = sp('test error with result')
        .pipe(asyncErrorFunc, [ 'next' ], '{key1, key2}')
        .error(errorHandler, '{error, key2, key1}')
        .end()

      func()
    })
  })

  describe('Exceptions', () => {
    it('should throw if error handler is not provided', () => {
      const func = sp('test no error handler')
        .pipe(() => { throw new Error() })
        .end()
      expect(() => func()).to.throw('Error was triggered in pipeline "test no error handler"')

      const errorFunc = function (next) {
        next(output.key5)
      }
      const func2 = sp('test no error handler with next')
        .input('errorFunc')
        .pipe('errorFunc')
        .end()
      expect(() => func2(errorFunc)).to.throw('Error was triggered in pipeline "test no error handler with next"')
    })

    it('should throw if next is called more than once in a pipe', () => {
      const func = sp('test calling next multiple times')
        .pipe((next) => {
          next()
          next()
        }, 'next')
        .end()
      expect(() => func()).to.throw('"next" could not be called more than once in a pipe.')
    })

    it('should throw if type of pipe is not supported', () => {
      const func = sp('test unsupported pipe function')
        .input('arg')
        .pipe('arg')
        .end()
      expect(() => func(1)).to.throw('Dependency "arg" is not a function or boolean.')
    })
  })
})
