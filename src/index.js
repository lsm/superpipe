import { createAPI } from './pipeline'

export default function(deps) {
  return function(name, defs) {
    return createAPI(name, defs, deps)
  }
}
