import type { PipeFunction, PipeParameter } from '../common'
import type Fetcher from '../parameter/Fetcher'
import type Producer from '../parameter/Producer'

export default interface Pipe {
  fn?: PipeFunction | null
  not?: boolean
  fnName: string
  optional?: boolean
  fetcher: Fetcher
  producer: Producer
  injected: boolean
}

export interface InputPipe {
  fnName: string
  producer: Producer
}

export type PipeDefinition = [PipeFunction, PipeParameter?, PipeParameter?]
