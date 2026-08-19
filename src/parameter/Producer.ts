import {
  isValidArrayParameters,
  objectStringToArray,
  type PipeOutput,
  type PipeParameter,
  type PipeResult,
  RE_IS_OBJ_STRING,
} from '../common'

const RE_RENAME = /^([^:]+):([^:]+)$/

// `'{...}'` — merge every key of the returned object into the store.
const SPREAD_ALL = '...'

function applyKey(output: Record<string, PipeResult>, key: string, value: PipeResult): void {
  const rename = RE_RENAME.exec(key)
  if (rename) {
    output[rename[2]] = value
  } else {
    output[key] = value
  }
}

// The output spec grammar. Each form means exactly one thing, independent
// of the produced value's runtime type:
//
//   'name'       bind the whole return value under `name`
//   '{a, b}'     pick the named properties
//   ['a', 'b']   destructure — positional for array returns, by name for objects
//   '{...}'      merge every key of the returned object
//   (no spec)    effects only — the return value is discarded
//
// A single `'a:b'` rename spec is a one-key pick: it stores the returned
// `a` under `b`, never the whole value.
type OutputForm = 'single' | 'object-string' | 'array' | 'spread' | 'none'

export default class Producer {
  private keys: string[] = []

  private _produce: (result: PipeResult) => PipeOutput

  private inputMode: boolean = false

  // Which grammar form the output spec took.
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

    // Output mode: the spec's grammar form — not the produced value's
    // runtime type — decides how the return value maps to outputs.
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
        // Rename syntax names a source property — a one-key destructure
        // that stores `source` under `destination`.
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
    this._produce = this.produceOutput
  }

  produce(result: PipeResult): PipeOutput {
    return this._produce(result)
  }

  // The output grammar in action — see OutputForm above. Binding never
  // depends on the runtime type of the return value to choose a form; the
  // type only shapes what a destructure can find.
  produceOutput(result: PipeResult): PipeOutput {
    // No spec: a side-effect pipe. Nothing it returns is stored — not even
    // a plain object, which earlier releases spread implicitly.
    if (this.form === 'none') {
      return {}
    }

    // '{...}': merge every key of the returned object. Asking to spread a
    // value that has no keys to spread is a definition bug, not a silent
    // no-op.
    if (this.form === 'spread') {
      if (Array.isArray(result) || result === null || typeof result !== 'object') {
        throw new Error(`Output spec "{...}" requires a plain-object return, got ${typeof result}.`)
      }
      return result
    }

    const output: Record<string, PipeResult> = {}
    const keys = this.keys
    const isArray = Array.isArray(result)
    const isObject = !isArray && result !== null && typeof result === 'object'

    // Braces select properties, from any return shape — a value without
    // the property yields undefined, exactly like reading a missing key.
    if (this.form === 'object-string') {
      for (const key of keys) {
        const rename = RE_RENAME.exec(key)
        output[rename ? rename[2] : key] = isObject
          ? (result as Record<string, PipeResult>)[rename ? rename[1] : key]
          : undefined
      }
      return output
    }

    // An array spec destructures: array returns map positionally, object
    // returns map by name. A single plain name never enters here — one
    // name, one value, whatever its type.
    if (this.form === 'array' && (isArray || isObject)) {
      if (isArray) {
        let i = 0
        for (const key of keys) {
          applyKey(output, key, result[i])
          i += 1
        }
        return output
      }
      for (const key of keys) {
        const rename = RE_RENAME.exec(key)
        output[rename ? rename[2] : key] = (result as Record<string, PipeResult>)[
          rename ? rename[1] : key
        ]
      }
      return output
    }

    // A single name binds the whole primitive return; multiple names have
    // nothing positional to map to.
    if (keys.length === 1) {
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
