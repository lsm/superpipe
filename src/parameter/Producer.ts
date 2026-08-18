import {
  isValidArrayParameters,
  objectStringToArray,
  type PipeOutput,
  type PipeParameter,
  type PipeResult,
  RE_IS_OBJ_STRING,
} from '../common'

const RE_RENAME = /^([^:]+):([^:]+)$/

function applyKey(output: Record<string, PipeResult>, key: string, value: PipeResult): void {
  const rename = RE_RENAME.exec(key)
  if (rename) {
    output[rename[2]] = value
  } else {
    output[key] = value
  }
}

export default class Producer {
  private keys: string[] = []

  private _produce: (result: PipeResult) => PipeOutput

  private inputMode: boolean = false

  private objString: boolean = false

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
        throw new Error(
          'Pipe input parameter must be non-empty string or array of non-empty strings',
        )
      }
      return
    }

    if (parameter === '') {
      throw new Error('Pipe output must be a non-empty string or array of non-empty strings')
    }
    if (typeof parameter === 'string') {
      if (RE_IS_OBJ_STRING.test(parameter)) {
        this.objString = true
        this.keys = objectStringToArray(parameter)
      } else {
        this.keys = [parameter]
      }
    } else if (Array.isArray(parameter)) {
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

  produceOutput(result: PipeResult): PipeOutput {
    const output: Record<string, PipeResult> = {}
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
        output[rename ? rename[2] : key] = (result as Record<string, PipeResult>)[
          rename ? rename[1] : key
        ]
      }
      return output
    }

    if (keys.length === 1) {
      applyKey(output, keys[0], this.objString ? undefined : result)
      return output
    }

    return {}
  }

  produceSingle(result: PipeResult): PipeOutput {
    return { [this.keys[0]]: this.inputSource(result) }
  }

  produceFromArray(result: PipeResult): PipeOutput {
    const output: Record<string, PipeResult> = {}

    let i = 0
    for (const key of this.keys) {
      output[key] = (result as PipeResult[])[i]
      i += 1
    }
    return output
  }

  produceFromObject(result: PipeResult): PipeOutput {
    const output: Record<string, PipeResult> = {}
    const source = this.inputSource(result) as Record<string, PipeResult> | null | undefined
    for (const key of this.keys) {
      output[key] = source == null ? undefined : source[key]
    }
    return output
  }

  private inputSource(result: PipeResult): PipeResult {
    return Array.isArray(result) ? result[0] : result
  }
}
