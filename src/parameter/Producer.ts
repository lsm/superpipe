import {
  PipeOutput,
  PipeResult,
  PipeParameter,
  RE_IS_OBJ_STRING,
  isValidArrayParameters,
  objectStringToArray,
} from '../common'

// `source:destination` renaming, e.g. an output of `'arg2:mappedArgName'`
// stores the returned `arg2` under `mappedArgName`.
const RE_RENAME = /^([^:]+):([^:]+)$/

function applyKey (output: PipeOutput, key: string, value: PipeResult): void {
  const rename = RE_RENAME.exec(key)
  if (rename) {
    output[rename[2]] = value
  } else {
    output[key] = value
  }
}

export default class Producer {
  // Array of property name to produce.
  private keys: string[] = []

  private _produce: Function

  // Input producers receive the wrapped invocation-arguments array, so
  // single-name and object-string specs read from its first element.
  private inputMode: boolean = false

  constructor(parameter: PipeParameter | undefined, flag?: string) {
    if (flag === 'input') {
      this.inputMode = true
    }

    if (typeof parameter === 'string') {
      if (RE_IS_OBJ_STRING.test(parameter)) {
        this.keys = objectStringToArray(parameter)
        this._produce = this.produceFromObject
      } else {
        this.keys[0] = parameter
        this._produce = this.produceSingle
      }
    } else if (isValidArrayParameters(parameter)) {
      this.keys = parameter as string[]
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

  produceNothing(result: PipeResult): PipeOutput {
    // With no output declared, a plain-object return is merged into the
    // runtime store so its keys stay available to later pipes.
    if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
      return result
    }
    return {}
  }

  produceSingle(result: PipeResult): PipeOutput {
    const key = this.keys[0]
    const source = this.inputSource(result)
    const rename = RE_RENAME.exec(key)

    if (rename) {
      return { [rename[2]]: source[rename[1]] }
    }
    return { [key]: source }
  }

  produceFromArray(result: PipeResult): PipeOutput {
    const output: PipeOutput = {}

    // A single output name with a single (non-array) return value is assigned
    // the whole value, not its first element.
    if (this.keys.length === 1 && !Array.isArray(result)) {
      const rename = RE_RENAME.exec(this.keys[0])
      if (rename) {
        return { [rename[2]]: result[rename[1]] }
      }
      output[this.keys[0]] = result
      return output
    }

    // Multiple output names with a plain-object return value are mapped by
    // property name, not by numeric index.
    if (!Array.isArray(result) && result !== null && typeof result === 'object') {
      for (const key of this.keys) {
        const rename = RE_RENAME.exec(key)
        if (rename) {
          output[rename[2]] = result[rename[1]]
        } else {
          output[key] = result[key]
        }
      }
      return output
    }

    // Positional mapping is only meaningful for array return values.
    if (!Array.isArray(result)) {
      throw new Error('Multiple pipe outputs require an array or object return value.')
    }

    let i = 0
    for (const key of this.keys) {
      applyKey(output, key, result[i])
      i += 1
    }

    return output
  }

  produceFromObject(result: PipeResult): PipeOutput {
    const output: PipeOutput = {}
    const source = this.inputSource(result)

    for (const key of this.keys) {
      // Only take the keys we need.
      output[key] = source[key]
    }

    return output
  }

  // In input mode the producer receives the wrapped arguments array; a
  // single-name or object-string spec addresses the first argument.
  private inputSource(result: PipeResult): PipeResult {
    return this.inputMode && Array.isArray(result) ? result[0] : result
  }
}
