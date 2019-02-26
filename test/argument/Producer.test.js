/* globals describe, it */
import { expect } from 'chai'
import Producer from '../../src/argument/Producer'

describe('Producer', () => {
  const result = {
    myArg: 'myArg value',
    mySecondArg: 'second arg value'
  }

  const arrayResult = ['myArg value', 'second arg value']

  describe('parse single string argument', () => {
    it('should produce output as an object', () => {
      const producer = new Producer('myArg')
      const output = producer.produce('myArg value')

      expect(output).to.deep.equal({ myArg: 'myArg value' })
    })
  })

  describe('parse array argument', () => {
    it('should o variables from result and output an object', () => {
      const producer = new Producer(['myArg'])
      const output = producer.produce(arrayResult)

      expect(output).to.deep.equal({ myArg: 'myArg value' })

      const producer2 = new Producer(['mySecondArg', 'myArg'])
      const output2 = producer2.produce(arrayResult)

      expect(output2).to.deep.equal({
        myArg: 'second arg value',
        mySecondArg: 'myArg value'
      })
    })
  })

  describe('parse object string argument', () => {
    it('should produce output as an object', () => {
      const producer1 = new Producer('{myArg}')
      const output1 = producer1.produce(result)

      expect(output1).to.deep.equal({ myArg: 'myArg value' })

      const producer2 = new Producer('{mySecondArg, myArg}')
      const output2 = producer2.produce(result)

      expect(output2).to.deep.equal(result)
    })
  })

  describe('invalid inputs', () => {
    it('should throw when using object string in an array', function name() {
      expect(() => new Producer(['{myArg}'])).to.throw(
        'Object string {myArg} is not allowed in array argument'
      )
    })

    it('should throw if the format of the argument is invalid', () => {
      expect(() => new Producer(1)).to.throw(
        'Pipe output argument must be string or array of strings'
      )
      expect(() => new Producer({})).to.throw(
        'Pipe output argument must be string or array of strings'
      )
    })
  })
})
