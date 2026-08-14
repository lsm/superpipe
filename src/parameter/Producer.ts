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
  // Array of property names to produce.
  private keys: string[] = []

  private _produce: Function

  // Input producers receive the wrapped invocation-arguments array, so
  // single-name and object-string specs read from its first element.
  private inputMode: boolean = false

  constructor(parameter: PipeParameter | undefined, flag?: string) {
    if (flag === 'input') {
      this.inputMode = true
    }

    if (this.inputMode) {
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
      } else {
        throw new Error('Pipe input parameter must be non-empty string or array of non-empty strings')
      }
      return
    }

    // Output mode: every spec form reduces to a list of output names; the
    // mapping semantics depend only on the produced value's shape.
    if (typeof parameter === 'string') {
      this.keys = RE_IS_OBJ_STRING.test(parameter)
        ? objectStringToArray(parameter)
        : [ parameter ]
    } else if (Array.isArray(parameter)) {
      // An empty output list means no declared outputs; otherwise every
      // element must be a non-empty plain string (no object-strings).
      if (parameter.length > 0 && !isValidArrayParameters(parameter)) {
        throw new Error('Pipe input/output parameter must be string or array of strings')
      }
      this.keys = parameter
    } else if (typeof parameter === 'undefined') {
      this.keys = []
    } else {
      throw new Error('Pipe input/output parameter must be string or array of strings')
    }
    this._produce = this.produceOutput
  }

  produce(result: PipeResult): PipeOutput {
    return this._produce(result)
  }

  // Mirrors master's setValueToStore: array results map positionally,
  // plain-object results map by property name (either counts), a scalar
  // maps whole under a single name, and with no outputs plain objects
  // merge while everything else is dropped.
  produceOutput(result: PipeResult): PipeOutput {
    const output: PipeOutput = {}
    const keys = this.keys
    const isArray = Array.isArray(result)
    const isObject = !isArray && result !== null && typeof result === 'object'

    if (keys.length === 0) {
      return isObject ? result : {}
    }

    if (isArray) {
      let i = 0
      for (const key of keys) {
        applyKey(output, key, result[i])
        i += 1
      }
      return output
    }

    if (isObject) {
      for (const key of keys) {
        const rename = RE_RENAME.exec(key)
        output[rename ? rename[2] : key] = result[rename ? rename[1] : key]
      }
      return output
    }

    if (keys.length === 1) {
      applyKey(output, keys[0], result)
      return output
    }

    // A primitive with multiple output names has nothing to map to.
    return {}
  }

  produceSingle(result: PipeResult): PipeOutput {
    return { [this.keys[0]]: this.inputSource(result) }
  }

  produceFromArray(result: PipeResult): PipeOutput {
    const output: PipeOutput = {}
    // Input names are literal — colon renaming applies to outputs only.
    let i = 0
    for (const key of this.keys) {
      output[key] = result[i]
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
    return Array.isArray(result) ? result[0] : result
  }
}
