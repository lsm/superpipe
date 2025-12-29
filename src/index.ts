import { createAPI } from './pipeline'
import type { Dependencies, PipelineAPI, PipelineDefinition, SuperPipeFactory } from './types'

export default function superpipe(deps?: Dependencies): SuperPipeFactory {
  return function(
    name: string,
    defs?: PipelineDefinition[]
  ): PipelineAPI | ((...args: unknown[]) => void) {
    return createAPI(name, defs, deps)
  }
}

// Export types for library consumers
export type {
  Pipe,
  Pipeline,
  PipeState,
  Store,
  Dependencies,
  PipelineAPI,
  PipelineDefinition,
  SuperPipeFactory
} from './types'
