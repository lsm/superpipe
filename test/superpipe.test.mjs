import { describe, expect, it } from 'vitest'
import superpipe, {
  AmbiguousContinuationError,
  NextCalledTwiceError,
  OutputKeyError,
  OutputNameError,
  PipelineAbortedError,
} from '../src'

describe('Superpipe', () => {
  describe('superpipe()', () => {
    it('should create pipeline constructor', () => {
      const sp = superpipe()
      expect(sp).to.be.a('function')

      const pipeline = sp('my pipeline')
      expect(pipeline.end).to.be.a('function')
      expect(pipeline.pipe).to.be.a('function')
      expect(pipeline.error).to.be.a('function')
      expect(pipeline.input).to.be.a('function')
    })
  })

  describe('superpipe(functions)', () => {
    it('should use `functions` as dependencies when creating pipeline', () =>
      new Promise((done) => {
        const functions = {
          func(key) {
            expect(key).to.equal('value')
            done()
          },
        }
        const sp = superpipe(functions)
        const pipeline = sp('key value pipeline').input('key').pipe('func', 'key').end()
        pipeline('value')
      }))

    it('should create pipeline function directly from definitions', () => {
      const sp = superpipe()
      const func = sp('from defs', [
        ['pipe1', 'arg'],
        ['end', 'arg'],
      ])
      expect(func).to.be.a('function')

      const pl = sp('builder form')
      expect(pl.pipe).to.be.a('function')
    })
  })

  describe('Exceptions', () => {
    const sp = superpipe()

    it('should throw if input is called not at the first place', () => {
      expect(() => {
        sp('mypl').pipe('abc').input(['arg'])
      }).to.throw('Input pipe must be the first pipe in the pipeline.')

      expect(() => {
        sp('mypl', [
          ['someFunc', 'arg', 'result'],
          ['input', '{arg}'],
        ])
      }).to.throw('Input pipe must be the first pipe in the pipeline.')
    })

    it('should throw when adding new pipe after error pipe', () => {
      expect(() => {
        sp('mypl').error('abc').pipe('arg')
      }).to.throw('Adding new pipe after error pipe is not allowed.')

      expect(() => {
        sp('mypl', [
          ['error', 'errorHandler', 'error input'],
          ['someFunc', ['arg']],
        ])
      }).to.throw('Adding new pipe after error pipe is not allowed.')
    })

    it('should throw when adding more than one error handler', () => {
      expect(() => {
        sp('mypl').error('abc').error('arg')
      }).to.throw('Each pipeline could only have one error handler.')

      expect(() => {
        sp('mypl', [
          ['error', 'arg', 'result'],
          ['error', '{arg}'],
        ])
      }).to.throw('Each pipeline could only have one error handler.')
    })
  })

  describe('error class exports', () => {
    it('exports every error the library can throw for instanceof discrimination', () => {
      expect(AmbiguousContinuationError).to.be.a('function')
      expect(NextCalledTwiceError).to.be.a('function')
      expect(OutputKeyError).to.be.a('function')
      expect(OutputNameError).to.be.a('function')
      expect(PipelineAbortedError).to.be.a('function')

      const run = superpipe()('missing-key', [[() => ({ ok: true }), undefined, '{missing}']])
      let caught
      try {
        run()
      } catch (err) {
        caught = err
      }
      expect(caught).to.be.instanceOf(OutputKeyError)
      expect(caught).to.not.be.instanceOf(OutputNameError)
      expect(caught).to.not.be.instanceOf(AmbiguousContinuationError)
    })
  })
})
