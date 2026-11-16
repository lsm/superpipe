import {
  type AnyFunction,
  type DescribedRunner,
  type DescribedSpec,
  type FunctionContainer,
  isNonEmptyString,
  type PipeFunction,
  type PipelineBase,
  type PipelineDescription,
  type PipeParameter,
  type PipeResult,
  type StepDescription,
  setEntry,
} from '../common'
import Fetcher from '../parameter/Fetcher'
import Producer from '../parameter/Producer'
import type Pipe from './Pipe'
import type { InputPipe } from './Pipe'

export enum FN_TYPE {
  END = 'end',
  ERROR = 'error',
  INPUT = 'input',
}

export function createPipe(
  fn: PipeFunction,
  input?: PipeParameter,
  output?: PipeParameter,
): Pipe | never {
  const pipe: Pipe = {
    fn: null,
    fnName: 'unknown',
    fetcher: new Fetcher(input),
    producer: new Producer(output),
    injected: false,
    input,
    output,
  }

  if (isNonEmptyString(fn)) {
    fn = fn as string

    pipe.not = /^!/.test(fn)
    if (pipe.not) {
      fn = fn.slice(1)
    }

    pipe.optional = /^\?/.test(fn)
    if (pipe.optional) {
      fn = fn.slice(1)
    }

    pipe.fnName = fn
    pipe.injected = true
  } else if (typeof fn === 'function') {
    pipe.fn = fn
    pipe.fnName = fn.name || 'anonymous'
  } else {
    throw new Error(`Unsupported pipe function type "${typeof fn}".`)
  }

  return pipe
}

export function createInputPipe(input: PipeParameter): InputPipe {
  const pipe: InputPipe = {
    fnName: 'input',
    producer: new Producer(input, 'input'),
    input,
  }

  return pipe
}

export interface Part {
  readonly name: string
  pipe(fn: PipeFunction, input?: PipeParameter, output?: PipeParameter): Part
}

const partSteps = new WeakMap<Part, { owner: object; pipes: readonly Pipe[] }>()

function ownSpec(spec: PipeParameter | undefined): PipeParameter | undefined {
  return Array.isArray(spec) ? (Object.freeze([...spec]) as string[]) : spec
}

export function createPart(name: string, owner: object, pipes: readonly Pipe[] = []): Part {
  const part: Part = Object.freeze({
    name,
    pipe(fn: PipeFunction, input?: PipeParameter, output?: PipeParameter): Part {
      if (fn === FN_TYPE.INPUT || fn === FN_TYPE.ERROR) {
        throw new Error(`A part holds steps only; "${fn}" belongs to the pipeline.`)
      }
      const pipe = createPipe(fn, ownSpec(input), ownSpec(output))
      pipe.part = name
      return createPart(name, owner, Object.freeze([...pipes, pipe]))
    },
  })
  partSteps.set(part, { owner, pipes })
  return part
}

export function partPipes(part: Part, owner: object | undefined): readonly Pipe[] {
  const entry = partSteps.get(part)
  if (entry === undefined || entry.owner !== owner) {
    throw new Error('A part can only be used by pipelines of the factory that declared it.')
  }
  return entry.pipes
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] }

function copySpec(spec: PipeParameter | null | undefined): DescribedSpec | undefined {
  if (spec == null) {
    return undefined
  }
  return Array.isArray(spec) ? Object.freeze([...spec]) : spec
}

export function describePipeline<Runner extends object>(
  runner: Runner,
  pipeline: PipelineBase,
  output: PipeParameter | undefined,
  async: boolean,
): Runner & DescribedRunner {
  const steps = pipeline.pipes.map((pipe): StepDescription => {
    const step: Mutable<StepDescription> = {
      name: pipe.fnName,
      injected: pipe.injected,
      not: pipe.not === true,
      optional: pipe.optional === true,
    }
    const input = copySpec(pipe.input)
    if (input !== undefined) {
      step.input = input
    }
    const output = copySpec(pipe.output)
    if (output !== undefined) {
      step.output = output
    }
    if (pipe.part !== undefined) {
      step.part = pipe.part
    }
    return Object.freeze(step)
  })
  const description: Mutable<PipelineDescription> = {
    name: pipeline.name,
    async,
    inputs: Object.freeze(
      (pipeline.inputPipes || []).map((pipe) => copySpec(pipe.input) as DescribedSpec),
    ),
    steps: Object.freeze(steps),
  }
  const end = copySpec(output)
  if (end !== undefined) {
    description.output = end
  }
  Object.defineProperty(runner, 'pipeline', {
    value: Object.freeze(description),
    enumerable: true,
  })
  return runner as Runner & DescribedRunner
}

export function createErrorPipe(errorFn: PipeFunction, input?: PipeParameter): AnyFunction {
  const fetcher = new Fetcher(input === undefined ? 'error' : input)

  if (fetcher.hasNext) {
    throw new Error('"next" could not be used in error pipe.')
  }

  let getErrorFn: (container: PipeResult, functions: FunctionContainer) => unknown

  if (isNonEmptyString(errorFn)) {
    const fnName: string = errorFn as string
    getErrorFn = (container: PipeResult, functions: FunctionContainer): AnyFunction => {
      const box = container as Record<string, unknown>
      if (Object.prototype.hasOwnProperty.call(box, fnName)) {
        return box[fnName] as AnyFunction
      }
      return functions[fnName] as AnyFunction
    }
  } else if (typeof errorFn === 'function') {
    getErrorFn = (): AnyFunction => errorFn as AnyFunction
  } else {
    throw new Error('Error handler must be a string or function.')
  }

  return function errorHandler(
    container: PipeResult,
    functions: FunctionContainer,
    error?: Error,
  ): void {
    const source: Record<string, PipeResult> = {}
    for (const key of Object.keys(container as Record<string, PipeResult>)) {
      setEntry(source, key, (container as Record<string, PipeResult>)[key])
    }
    source.error = error as PipeResult
    const inputArgs = fetcher.fetch(source, [], functions)
    const fn = getErrorFn(container, functions) as AnyFunction | undefined
    if (typeof fn === 'function') {
      ;(fn as (...args: PipeResult[]) => unknown)(...(inputArgs as PipeResult[]))
    } else {
      throw new Error(`Error handler "${errorFn}" is not a function.`)
    }
  }
}
