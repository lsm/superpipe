import {
  RE_IS_OBJ_STRING,
  isValidArrayArgs,
  objectStringToArray
} from './common'

export default class Producer {
  constructor(args) {
    if (typeof args === 'string') {
      if (RE_IS_OBJ_STRING.test(args)) {
        this.keys = objectStringToArray(args)
        this._produce = this.produceFromObject
      } else {
        this.key = args
        this.keys = [args]
        this._produce = this.produceSingle
      }
    } else if (isValidArrayArgs(args)) {
      this.keys = args
      this._produce = this.produceFromArray
    } else if (typeof args === 'undefined') {
      this._produce = this.produceNothing
    } else {
      throw new Error('Pipe output argument must be string or array of strings')
    }
  }

  produce(result) {
    return this._produce(result)
  }

  produceNothing() {
    return {}
  }

  produceSingle(result) {
    return { [this.key]: result }
  }

  produceFromArray(result) {
    let i = 0
    const output = {}

    for (const key of this.keys) {
      output[key] = result[i]
      i += 1
    }

    return output
  }

  produceFromObject(result) {
    const output = {}

    for (const key of this.keys) {
      // Only take the keys we need.
      output[key] = result[key]
    }

    return output
  }
}
