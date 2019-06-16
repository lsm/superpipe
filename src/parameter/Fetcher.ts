import {
  PipeOutput,
  PipeResult,
  PipeParameter,
  RE_IS_OBJ_STRING,
  isValidArrayParameters,
  objectStringToArray,
} from '../common'

export default class Fetcher {
  // Array of property name to fetch.
  private keys: string[] = []

  private _fetch: Function = this.fetchNothing

  hasNext: boolean

  constructor (parameter: PipeParameter, flag?: string) {
    if (typeof parameter === 'string') {
      if (RE_IS_OBJ_STRING.test(parameter)) {
        this.keys = objectStringToArray(parameter)
        this._fetch = this.fetchAsObject
      } else if (flag === 'raw') {
        this.keys = [ parameter ]
        this._fetch = this.fetchSingle
      }
      // Normalize string as array.
      // When it's not object string or flag equals raw.
      parameter = [ parameter ]
    }

    if (!this._fetch) {
      if (isValidArrayParameters(parameter)) {
        this.keys = parameter
        this._fetch = this.fetchAsArray
      } else if (parameter == null) {
        this.keys = []
        this._fetch = this.fetchNothing
      } else {
        throw new Error('Pipe input parameter must be non-empty string or array of non-empty strings')
      }
    }

    this.hasNext = this.keys.indexOf('next') > -1
  }

  fetch (container: PipeResult): PipeOutput {
    return this._fetch(container)
  }

  fetchNothing (): PipeOutput {
    return null
  }

  fetchSingle (container: PipeResult): PipeOutput {
    return container[this.keys[0]]
  }

  fetchAsArray (container: PipeResult): PipeOutput {
    return this.keys.map((key: string): PipeResult => container[key])
  }

  fetchAsObject (container: PipeResult): PipeOutput {
    const result: PipeResult = {}

    for (const key of this.keys) {
      result[key] = container[key]
    }

    return [ result ]
  }
}
