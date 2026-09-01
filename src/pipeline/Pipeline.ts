import {
  type AbortSignalLike,
  type AnyFunction,
  type AsyncPipelineRunner,
  type FunctionContainer,
  type PipeFunction,
  PipelineAbortedError,
  type PipelineBase,
  type PipeOutput,
  type PipeParameter,
  type PipeResult,
  signalAborted,
  signalReason,
} from '../common'
import Fetcher from '../parameter/Fetcher'
import { createErrorPipe, createInputPipe, createPipe } from './builder'
import { runPipeline } from './executor'
import type Pipe from './Pipe'
import type { InputPipe } from './Pipe'

export default class Pipeline implements PipelineBase {
  name: string

  pipes: Pipe[] = []

  functions: FunctionContainer

  inputPipes: InputPipe[] = []

  errorHandler?: AnyFunction

  constructor(name: string, functions?: FunctionContainer) {
    this.name = name

    this.functions = functions || {}
  }

  input(input?: PipeParameter): Pipeline {
    if (this.pipes.length > 0) {
      throw new Error('Input pipe must be the first pipe in the pipeline.')
    }
    if (input == null || input === '' || (Array.isArray(input) && input.length === 0)) {
      throw new Error('Input pipe requires a non-empty string or array of non-empty strings.')
    }

    this.inputPipes.push(createInputPipe(input))
    return this
  }

  pipe(fn: PipeFunction, input?: PipeParameter, output?: PipeParameter): Pipeline {
    if (this.errorHandler) {
      throw new Error('Adding new pipe after error pipe is not allowed.')
    }

    if (fn === 'input') {
      return this.input(input)
    }
    if (fn === 'error') {
      return this.error(input as PipeFunction, output)
    }
    const pipe = createPipe(fn, input, output)
    this.pipes.push(pipe)
    return this
  }

  error(fn: PipeFunction, input?: PipeParameter): Pipeline {
    if (this.errorHandler) {
      throw new Error('Each pipeline could only have one error handler.')
    }
    this.errorHandler = createErrorPipe(fn, input)
    return this
  }

  end(output?: PipeParameter): (...args: unknown[]) => PipeOutput {
    const fetcher = new Fetcher(output, 'raw')

    const pipeline: PipelineBase = {
      name: this.name,
      pipes: [...this.pipes],
      inputPipes: [...this.inputPipes],
      functions: this.functions,
      errorHandler: this.errorHandler,
    }

    if (output === undefined) {
      return function (): undefined {
        runPipeline(Array.prototype.slice.apply(arguments), pipeline)
      }
    }

    return function (): PipeOutput {
      const args: PipeResult = Array.prototype.slice.apply(arguments)

      let terminal = false
      let reason: PipeResult

      const container = runPipeline(args, pipeline, undefined, undefined, (value) => {
        terminal = true
        reason = value
      })
      if (terminal) {
        return reason
      }
      return fetcher.fetch(container, [], pipeline.functions)
    }
  }

  endAsync(output?: PipeParameter): AsyncPipelineRunner {
    const fetcher = output === undefined ? null : new Fetcher(output, 'raw')

    const pipeline: PipelineBase = {
      name: this.name,
      pipes: [...this.pipes],
      inputPipes: [...this.inputPipes],
      functions: this.functions,
      errorHandler: this.errorHandler,
    }

    const runPipelinePromise = (
      args: PipeResult,
      onRegisterCancel?: (cancel: (reason: unknown) => void) => void,
    ): Promise<PipeOutput> =>
      new Promise<PipeOutput>((resolve, reject) => {
        runPipeline(
          args,
          pipeline,
          (outcome) => {
            if (outcome.error != null) {
              reject(outcome.error)
              return
            }

            if (outcome.terminal && fetcher !== null) {
              resolve(outcome.reason as PipeOutput)
              return
            }

            if (fetcher === null) {
              resolve(undefined as PipeOutput)
              return
            }
            try {
              resolve(fetcher.fetch(outcome.container, [], pipeline.functions) as PipeOutput)
            } catch (err) {
              reject(err as Error)
            }
          },
          onRegisterCancel,
        )
      })

    const run = function (): Promise<PipeOutput> {
      return runPipelinePromise(Array.prototype.slice.apply(arguments))
    } as AsyncPipelineRunner

    run.withSignal = (signal: AbortSignalLike, ...args: unknown[]): Promise<PipeOutput> => {
      if (signalAborted(signal)) {
        return Promise.reject(new PipelineAbortedError(signalReason(signal)))
      }

      let cancelRun: ((reason: unknown) => void) | undefined
      const onAbort = (): void => {
        cancelRun?.(signalReason(signal))
      }

      try {
        signal.addEventListener('abort', onAbort)
      } catch (err) {
        return Promise.reject(err)
      }

      return runPipelinePromise(args, (cancel) => {
        cancelRun = cancel
        if (signalAborted(signal)) {
          onAbort()
        }
      }).finally(() => {
        try {
          signal.removeEventListener('abort', onAbort)
        } catch {}
      })
    }

    return run
  }
}
