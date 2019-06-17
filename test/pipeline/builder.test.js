import { expect } from 'chai'
import { describe, it } from 'mocha'
import {
  createPipe,
  createErrorPipe,
  createInputPipe,
  createPipesFromDefs,
} from '../../src/pipeline/builder'

import Fetcher from '../../src/parameter/Fetcher'
import Producer from '../../src/parameter/Producer'
import superpipe from '../../src'

describe('Test pipe builder', () => {
  describe('createPipe(fn, input, output)', () => {
    it('should create a pipe from function', () => {
      const myPipeFunction = function () {}
      const pipe = createPipe(myPipeFunction, [ 'input' ], '{output}')

      expect(pipe.fn).to.equal(myPipeFunction)
      expect(pipe.fnName).to.equal('myPipeFunction')
      expect(pipe.injected).to.equal(false)
      expect(pipe.fetcher).to.be.an.instanceof(Fetcher)
      expect(pipe.producer).to.be.an.instanceof(Producer)
    })

    it('should create an injected pipe from string', () => {
      const myFunctionName = 'myFunc'
      const pipe = createPipe(myFunctionName, [ 'input' ], '{output}')

      expect(pipe.fn).to.equal(null)
      expect(pipe.fnName).to.equal('myFunc')
      expect(pipe.injected).to.equal(true)
      expect(pipe.fetcher).to.be.an.instanceof(Fetcher)
      expect(pipe.producer).to.be.an.instanceof(Producer)
    })

    it('should create an optional pipe when function name start with ?', () => {
      const myFunctionName = 'myFunc?'
      const pipe = createPipe(myFunctionName, [ 'input' ], '{output}')

      expect(pipe.fn).to.equal(null)
      expect(pipe.fnName).to.equal('myFunc')
      expect(pipe.not).to.equal(false)
      expect(pipe.injected).to.equal(true)
      expect(pipe.optional).to.equal(true)
      expect(pipe.fetcher).to.be.an.instanceof(Fetcher)
      expect(pipe.producer).to.be.an.instanceof(Producer)
    })

    it('should create a not pipe when function name start with !', () => {
      const myFunctionName = '!myFunc'
      const pipe = createPipe(myFunctionName, [ 'input' ], '{output}')

      expect(pipe.fn).to.equal(null)
      expect(pipe.fnName).to.equal('myFunc')
      expect(pipe.not).to.equal(true)
      expect(pipe.injected).to.equal(true)
      expect(pipe.optional).to.equal(false)
      expect(pipe.fetcher).to.be.an.instanceof(Fetcher)
      expect(pipe.producer).to.be.an.instanceof(Producer)
    })

    it('should throw if the format of the pipe is unsupported', () => {
      expect(() => createPipe('', [ 'input' ], '{output}')).to.throw('Unsupported pipe function type "string"')
      expect(() => createPipe(true, [ 'input' ], '{output}')).to.throw('Unsupported pipe function type "boolean"')
      expect(() => createPipe(null, [ 'input' ], '{output}')).to.throw('Unsupported pipe function type "object"')
      expect(() => createPipe(1, [ 'input' ], '{output}')).to.throw('Unsupported pipe function type "number"')
      expect(() => createPipe({}, [ 'input' ], '{output}')).to.throw('Unsupported pipe function type "object"')
      expect(() => createPipe([], [ 'input' ], '{output}')).to.throw('Unsupported pipe function type "object"')
    })
  })

  describe('createInputPipe(input)', () => {
    it('should create an input pipe', () => {
      const pipe = createInputPipe('{input}')

      expect(pipe.fetcher).to.be.equal(undefined)
      expect(pipe.producer).to.be.an.instanceof(Producer)
    })
  })

  describe('createErrorPipe(errorFn, input)', () => {
    it('should create an error pipe (injected) from string', (done) => {
      const pipe = createErrorPipe('errorHandlerFunc', 'MyError')
      const container = { MyError: 'My error message' }
      const functions = {
        errorHandlerFunc: function (error) {
          expect(error).to.equal(container.MyError)
          done()
        },
      }

      expect(pipe).to.be.a('function')
      pipe(container, functions)
    })

    it('should create an error pipe from a function', (done) => {
      const myErrorHandlerFunc = function (error) {
        expect(error).to.equal(container.error)
        done()
      }
      const pipe = createErrorPipe(myErrorHandlerFunc)
      const container = { error: 'My error message' }

      expect(pipe).to.be.a('function')

      pipe(container)
    })

    it('should throw if the format of the error pipe is unsupported', () => {
      expect(() => createErrorPipe('', [ 'input' ])).to.throw('Error handler must be a string or function')
      expect(() => createErrorPipe(true, [ 'input' ])).to.throw('Error handler must be a string or function')
      expect(() => createErrorPipe(null, [ 'input' ])).to.throw('Error handler must be a string or function')
      expect(() => createErrorPipe(1, [ 'input' ])).to.throw('Error handler must be a string or function')
      expect(() => createErrorPipe({}, [ 'input' ])).to.throw('Error handler must be a string or function')
      expect(() => createErrorPipe([], [ 'input' ])).to.throw('Error handler must be a string or function')
      expect(() => createErrorPipe('error', [ 'next' ])).to.throw('"next" could not be used in error pipe.')
      expect(() => createErrorPipe('error', [ 'input', 'next' ])).to.throw('"next" could not be used in error pipe.')
      expect(() => createErrorPipe('error', 'next')).to.throw('"next" could not be used in error pipe.')
      expect(() => createErrorPipe('error', '{next}')).to.throw('"next" could not be used in error pipe.')
      expect(() => createErrorPipe('error', '{input, next}')).to.throw('"next" could not be used in error pipe.')

      const errorHandler = createErrorPipe('no such function')
      expect(() => {
        errorHandler({}, {})
      }).to.throw('Error handler "no such function" is not a function')
    })
  })

  // describe('createPipesFromDefs(pipeline, definitions)', () => {
  //   it('should create pipes based on the definitions', () => {
  //     const defs = [
  //       [ 'input', '{myKey}' ],
  //       [ function () {}, '{input}', 'output' ],
  //       [ 'myFunc', 'input', [ 'output' ] ],
  //       [ 'error', 'myErrorHandlerFunc', 'error' ],
  //       [ 'end', '{output}' ],
  //     ]

  //     const pipeline = superpipe()('myPipelineName')
  //     const func = createPipesFromDefs(pipeline, defs)
  //     const pipes = pipeline._pipes

  //     expect(func).to.be.a('function')
  //     expect(pipes[0].isInputPipe).to.equal(true)
  //     expect(pipes[1].fn).to.equal(defs[1][0])
  //     expect(pipes[2].fnName).to.equal('myFunc')
  //     expect(pipeline.errorHandler).to.be.a('function')
  //     expect(pipes[4]).to.equal(undefined)
  //   })
  // })
})
