import { createPipeline } from './pipeline'

export default function(deps) {
  return function(name, defs) {
    return createPipeline(name, defs, deps)
  }
}
