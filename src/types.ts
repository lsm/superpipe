/**
 * Core type definitions for SuperPipe.
 * These types preserve the existing API while adding type safety.
 */

export type PipeFunction = ((...args: unknown[]) => unknown) | string | null

export interface Pipe {
  fn: ((...args: unknown[]) => unknown) | null
  fnName: string | undefined
  input: string[]
  output?: string[]
  not?: boolean
  optional?: boolean
}

export interface Dependencies {
  [key: string]: unknown
}

export interface Pipeline {
  name: string
  pipes: Pipe[]
  errorHandler?: Pipe
  deps: Dependencies
}

export interface PipeState {
  fn: ((...args: unknown[]) => unknown) | null
  not?: boolean
  deps: Dependencies
  input: string[]
  output?: string[]
  fnName: string | undefined
  autoNext: boolean | 0
  optional?: boolean
  name: string
  error?: unknown
  result?: unknown
  fnReturned?: boolean
}

export interface Store {
  next: (err?: unknown, value?: unknown) => void
  error?: unknown
  [key: string]: unknown
}

export type PipeFunctionArg = ((...args: unknown[]) => unknown) | string

export interface PipelineAPI {
  input: (input: string | string[]) => PipelineAPI
  pipe: (fn: PipeFunctionArg, input?: string | string[], output?: string | string[]) => PipelineAPI
  error: (fn: PipeFunctionArg, input?: string | string[]) => PipelineAPI
  end: () => (...args: unknown[]) => void
}

export type PipelineDefinition = [PipeFunction, (string | string[])?, (string | string[])?]

export type SuperPipeFactory = (name: string, defs?: PipelineDefinition[]) => PipelineAPI | ((...args: unknown[]) => void)
