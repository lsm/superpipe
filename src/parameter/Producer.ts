import {
  isValidArrayParameters,
  OutputKeyError,
  objectStringToArray,
  type PipeOutput,
  type PipeParameter,
  type PipeResult,
  RE_IS_OBJ_STRING,
} from '../common'

function setEntry(target: Record<string, PipeResult>, key: string, value: PipeResult): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    })
    return
  }
  target[key] = value
}

const RE_RENAME = /^([^:]+):([^:]+)$/

const SPREAD_ALL = '...'

function applyKey(output: Record<string, PipeResult>, key: string, value: PipeResult): void {
  const rename = RE_RENAME.exec(key)
  setEntry(output, rename ? rename[2] : key, value)
}

type OutputForm = 'single' | 'object-string' | 'array' | 'spread' | 'none'

export default class Producer {
  private keys: string[] = []

  private _produce: (result: PipeResult) => PipeOutput

  private inputMode: boolean = false

  private form: OutputForm = 'none'

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
        const keys = objectStringToArray(parameter)
        if (keys.length === 1 && keys[0] === SPREAD_ALL) {
          this.form = 'spread'
        } else {
          this.form = 'object-string'
          this.keys = keys
        }
      } else if (RE_RENAME.test(parameter)) {
        this.form = 'object-string'
        this.keys = [parameter]
      } else {
        this.form = 'single'
        this.keys = [parameter]
      }
    } else if (Array.isArray(parameter)) {
      if (parameter.length > 0 && !isValidArrayParameters(parameter)) {
        throw new Error('Pipe input/output parameter must be string or array of strings')
      }
      this.form = parameter.length > 0 ? 'array' : 'none'
      this.keys = parameter
    } else if (typeof parameter === 'undefined') {
      this.form = 'none'
      this.keys = []
    } else {
      throw new Error('Pipe input/output parameter must be string or array of strings')
    }
    if (this.form !== 'spread') {
      for (const key of this.keys) {
        const destination = RE_RENAME.exec(key)?.[2] ?? key
        if (destination === '...' || destination.startsWith('...')) {
          throw new Error(
            `Output name "${key}" is not valid — the "..." marker only works as the entire spec: '{...}' (merge every key), or list names without it.`,
          )
        }
      }
    }
    this._produce = this.produceOutput
  }

  produce(result: PipeResult, errorPath?: boolean): PipeOutput {
    if (this.inputMode || !errorPath) {
      return this._produce(result)
    }
    return this.produceOutput(result, true)
  }

  expectValue(): void {
    if (this.inputMode || this.form === 'single' || this.form === 'none') {
      return
    }
    throw new OutputKeyError(
      `Output spec ${this.specLabel()} requires the pipe to return a value, but it returned none.`,
    )
  }

  private specLabel(): string {
    if (this.form === 'spread') {
      return '"{...}"'
    }
    if (this.form === 'array') {
      return `[${this.keys.map((key) => `'${key}'`).join(', ')}]`
    }
    return `"{${this.keys.join(', ')}}"`
  }

  produceOutput(result: PipeResult, errorPath?: boolean): PipeOutput {
    if (this.form === 'none') {
      return {}
    }

    if (this.form === 'spread') {
      if (Array.isArray(result) || result === null || typeof result !== 'object') {
        if (errorPath) {
          return {}
        }
        throw new OutputKeyError(
          `Output spec "{...}" requires a plain-object return, got ${typeof result}.`,
        )
      }
      return result
    }

    const output: Record<string, PipeResult> = {}
    const keys = this.keys
    const isArray = Array.isArray(result)
    const isObject = !isArray && result !== null && typeof result === 'object'

    if (this.form === 'object-string') {
      if (!isObject) {
        if (errorPath) {
          return {}
        }
        throw new OutputKeyError(
          `Output spec "{${keys.join(', ')}}" picks properties, but the pipe returned ${
            isArray ? 'an array' : typeof result
          }.`,
        )
      }
      for (const key of keys) {
        const rename = RE_RENAME.exec(key)
        const source = rename ? rename[1] : key
        if (!errorPath && !(source in (result as object))) {
          throw new OutputKeyError(`Output "${source}" is missing from the pipe's returned object.`)
        }
        setEntry(output, rename ? rename[2] : key, (result as Record<string, PipeResult>)[source])
      }
      return output
    }

    if (this.form === 'array' && (isArray || isObject)) {
      if (isArray) {
        let i = 0
        for (const key of keys) {
          if (!errorPath && i >= result.length) {
            throw new OutputKeyError(
              `Output "${key}" maps position ${i}, but the pipe's array return has ${result.length} element(s).`,
            )
          }
          applyKey(output, key, result[i])
          i += 1
        }
        return output
      }
      for (const key of keys) {
        const rename = RE_RENAME.exec(key)
        const source = rename ? rename[1] : key
        if (!errorPath && !(source in (result as object))) {
          throw new OutputKeyError(`Output "${source}" is missing from the pipe's returned object.`)
        }
        setEntry(output, rename ? rename[2] : key, (result as Record<string, PipeResult>)[source])
      }
      return output
    }

    if (this.form === 'array') {
      if (errorPath) {
        return {}
      }
      throw new OutputKeyError(
        `Output spec [${keys.map((key) => `'${key}'`).join(', ')}] destructures, but the pipe returned ${typeof result}.`,
      )
    }

    if (this.form === 'single') {
      applyKey(output, keys[0], result)
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
      setEntry(output, key, (result as PipeResult[])[i])
      i += 1
    }
    return output
  }

  produceFromObject(result: PipeResult): PipeOutput {
    const output: Record<string, PipeResult> = {}
    const source = this.inputSource(result) as Record<string, PipeResult> | null | undefined
    for (const key of this.keys) {
      setEntry(output, key, source == null ? undefined : source[key])
    }
    return output
  }

  private inputSource(result: PipeResult): PipeResult {
    return Array.isArray(result) ? result[0] : result
  }
}
