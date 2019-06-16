/* globals describe, it */
import { expect } from 'chai'
import Fetcher from '../../src/argument/Fetcher'

describe('Fetcher', () => {
  const container = {
    myArg: 'myArg value',
    mySecondArg: 'second arg value'
  }

  describe('allow empty input', () => {
    it('should okay with no input and produce null as output', () => {
      const fetcher = new Fetcher()
      const result = fetcher.fetch({ key: 'value' })
      expect(result).to.deep.equal(result)
    })
  })

  describe('parse single string argument', () => {
    it('should fetch the variable and return it in an array', () => {
      const fetcher = new Fetcher('myArg')
      const result = fetcher.fetch(container)

      expect(result).to.deep.equal(['myArg value'])

      const rawFetcher = new Fetcher('myArg', 'raw')
      const rawResult = rawFetcher.fetch(container)

      expect(rawResult).to.equal('myArg value')
    })
  })

  describe('parse array argument', () => {
    it('should fetch values from container and return array', () => {
      const fetcher = new Fetcher(['myArg'])
      const result = fetcher.fetch(container)

      expect(result).to.deep.equal(['myArg value'])

      const fetcher2 = new Fetcher(['mySecondArg', 'myArg'])
      const result2 = fetcher2.fetch(container)

      expect(result2).to.deep.equal(['second arg value', 'myArg value'])
    })
  })

  describe('parse object string argument', () => {
    it('should fetch variables and return as an object', () => {
      const fetcher1 = new Fetcher('{myArg}')
      const result1 = fetcher1.fetch(container)

      expect(result1).to.deep.equal([{ myArg: 'myArg value' }])

      const fetcher2 = new Fetcher('{mySecondArg, myArg}')
      const result2 = fetcher2.fetch(container)

      expect(result2).to.deep.equal([container])
    })
  })

  describe('invalid inputs', () => {
    it('should throw when using object string in an array', () => {
      expect(() => new Fetcher(['{myArg}'])).to.throw(
        'Object string {myArg} is not allowed in array argument'
      )
    })

    it('should throw if the format of the argument is invalid', () => {
      expect(() => new Fetcher(1)).to.throw(
        'Pipe input argument must be non-empty string or array of non-empty strings'
      )
      expect(() => new Fetcher({})).to.throw(
        'Pipe input argument must be non-empty string or array of non-empty strings'
      )
      expect(() => new Fetcher('')).to.throw(
        'Pipe input argument must be non-empty string or array of non-empty strings'
      )
      expect(() => new Fetcher([])).to.throw(
        'Pipe input argument must be non-empty string or array of non-empty strings'
      )
      expect(() => new Fetcher([''])).to.throw(
        'Pipe input argument must be non-empty string or array of non-empty strings'
      )
    })
  })
})
