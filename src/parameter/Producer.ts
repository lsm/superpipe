import {
  PipeOutput,
  PipeResult,
  PipeParameter,
  RE_IS_OBJ_STRING,
  isValidArrayParameters,
  objectStringToArray,
} from '../common'

export default class Producer {
  // Array of property name to produce.
  private keys: string[] = []

  private _produce: Function

  constructor(parameter: PipeParameter) {
    if (typeof parameter === 'string') {
      if (RE_IS_OBJ_STRING.test(parameter)) {
        this.keys = objectStringToArray(parameter)
        this._produce = this.produceFromObject
      } else {
        this.keys[0] = parameter
        this._produce = this.produceSingle
      }
    } else if (isValidArrayParameters(parameter)) {
      this.keys = parameter
      this._produce = this.produceFromArray
    } else if (typeof parameter === 'undefined') {
      this._produce = this.produceNothing
    } else {
      throw new Error('Pipe input/output parameter must be string or array of strings')
    }
  }

  produce(result: PipeResult): PipeOutput {
    return this._produce(result)
  }

  produceNothing(): PipeOutput {
    return {}
  }

  produceSingle(result: PipeResult): PipeOutput {
    return { [this.keys[0]]: result }
  }

  produceFromArray(result: PipeResult): PipeOutput {
    let i = 0
    const output: PipeOutput = {}

    for (const key of this.keys) {
      output[key] = result[i]
      i += 1
    }

    return output
  }

  produceFromObject(result: PipeResult): PipeOutput {
    const output: PipeOutput = {}

    for (const key of this.keys) {
      // Only take the keys we need.
      output[key] = result[key]
    }

    return output
  }
}
