import { expect } from 'chai'
import { describe, it } from 'mocha'
import superpipe from '../src'

describe('Superpipe', function () {
  describe('superpipe()', function () {
    it('should create pipeline constructor', function () {
      let sp = superpipe()
      expect(sp).to.be.a('function')

      let pipeline = sp('my pipeline')
      expect(pipeline.end).to.be.a('function')
      expect(pipeline.pipe).to.be.a('function')
      expect(pipeline.error).to.be.a('function')
      expect(pipeline.input).to.be.a('function')
    })
  })

  describe('superpipe(functions)', function () {
    it('should use `functions` as dependencies when creating pipeline', (done) => {
      const functions = {
        func (key) {
          expect(key).to.equal('value')
          done()
        }
      }
      var sp = superpipe(functions)
      const pipeline = sp('key value pipeline')
        .input('key')
        .pipe('func', 'key')
        .end()
      pipeline('value')
    })

    it('should create pipeline function directly from definitions', () => {
      const sp = superpipe()
      const func = sp('from defs', [
        ['pipe1', 'arg'],
        ['end', 'arg']
      ])
      expect(func).to.be.a('function')

      const pl = sp('from defs', [
        ['pipe1', 'arg'],
        ['pipe2', 'arg']
      ])
      expect(pl.pipe).to.be.a('function')
    })
  })

  describe('Exceptions', () => {
    const sp = superpipe()

    it('should throw if input is called not at the first place', () => {
      expect(() => {
        sp('mypl')
          .pipe('abc')
          .input(['arg'])
      }).to.throw('Input must be called before any other pipes.')

      expect(() => {
        sp('mypl', [
          ['someFunc', 'arg', 'result'],
          ['input', '{arg}']
        ])
      }).to.throw('Input must be called before any other pipes.')
    })

    it('should throw when adding new pipe after error pipe', () => {
      expect(() => {
        sp('mypl')
          .error('abc')
          .pipe('arg')
      }).to.throw('Adding new pipe after error pipe is not allowed.')

      expect(() => {
        sp('mypl', [
          ['error', 'errorHandler', 'error input'],
          ['someFunc', ['arg']]
        ])
      }).to.throw('Adding new pipe after error pipe is not allowed.')
    })

    it('should throw when adding more than one error handler', () => {
      expect(() => {
        sp('mypl')
          .error('abc')
          .error('arg')
      }).to.throw('Each pipeline could only have one error handler.')

      expect(() => {
        sp('mypl', [
          ['error', 'arg', 'result'],
          ['error', '{arg}']
        ])
      }).to.throw('Each pipeline could only have one error handler.')
    })
  })
})
