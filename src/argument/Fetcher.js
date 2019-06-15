import {
  RE_IS_OBJ_STRING,
  isValidArrayArgs,
  objectStringToArray,
} from './common'

export default class Fetcher {
  constructor (args, flag) {
    if (typeof args === 'string') {
      if (RE_IS_OBJ_STRING.test(args)) {
        this.keys = objectStringToArray(args)
        this._fetch = this.fetchAsObject
      } else if (flag === 'raw') {
        this._key = args
        this.keys = [ args ]
        this._fetch = this.fetchSingle
      }
      // Normalize string as array.
      // When it's not object string or flag equals raw.
      args = [ args ]
    }

    if (!this._fetch) {
      if (isValidArrayArgs(args)) {
        this.keys = args
        this._fetch = this.fetchAsArray
      } else if (args == null) {
        this.keys = []
        this._fetch = this.fetchNothing
      } else {
        throw new Error('Pipe input argument must be non-empty string or array of non-empty strings')
      }
    }

    this.hasNext = this.keys.indexOf('next') > -1
  }

  fetch (container) {
    return this._fetch(container)
  }

  fetchNothing () {
    return null
  }

  fetchSingle (container) {
    return container[this._key]
  }

  fetchAsArray (container) {
    return this.keys.map(key => container[key])
  }

  fetchAsObject (container) {
    const result = {}

    for (const key of this.keys) {
      result[key] = container[key]
    }

    return [ result ]
  }
}
