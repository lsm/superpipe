import Fetcher from '../parameter/Fetcher'
import Producer from '../parameter/Producer'
import { PipeFunction, PipeParameter } from '../common'

export default interface Pipe {
  fn?: PipeFunction | null;
  not?: boolean;
  fnName: string;
  optional?: boolean;
  fetcher: Fetcher;
  producer: Producer;
  injected: boolean;
}

export interface InputPipe {
  fnName: string;
  producer: Producer;
}

export type PipeDefinition = [ PipeFunction, PipeParameter, PipeParameter ]
