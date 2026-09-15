import {
  AmbiguousContinuationError,
  type AnyFunction,
  type FunctionContainer,
  NextCalledTwiceError,
  OutputKeyError,
  OutputNameError,
  PipelineAbortedError,
  type PipelineBase,
  type PipelineExit,
  type PipelineExitVia,
  type PipeOutput,
  type PipeResult,
  type ResultContainer,
  setEntry,
  throwNoErrorHandlerError,
} from '../common'
import type { NextCallbacks } from '../parameter/Fetcher'
import type Pipe from './Pipe'

function holdNextCallbacks(callbacks: NextCallbacks): void {
  callbacks.holding = true
}

function flushNextCallbacks(
  state: PipeState,
  pipeline: PipelineBase,
  next: Continuation,
  callbacks: NextCallbacks,
): void {
  callbacks.holding = false
  while (callbacks.held.length > 0) {
    const held = callbacks.held.shift()
    if (held) {
      next(state, pipeline, held.error, held.value, callbacks.pipeIndex)
    }
  }
}

function invalidateNextCallbacks(callbacks: NextCallbacks): void {
  for (const wrapper of callbacks.wrappers) {
    wrapper.disable()
  }
  callbacks.held.length = 0
}

type Continuation = (
  state: PipeState,
  pipeline: PipelineBase,
  error?: Error | null,
  value?: PipeResult,
  fromStep?: number,
) => void

type ErrorHandler = (
  container: ResultContainer,
  functions: FunctionContainer,
  error?: Error,
) => void

const RESERVED_OUTPUT_NAMES = ['next']

function hasConfiguredDependency(functions: FunctionContainer, key: string): boolean {
  for (let obj: unknown = functions; obj != null; obj = Object.getPrototypeOf(obj)) {
    if (obj === Object.prototype) return false
    if (Object.prototype.hasOwnProperty.call(obj, key)) return true
  }
  return false
}

function swallow(value: unknown): void {
  Promise.resolve(value).then(
    () => {},
    () => {},
  )
}

function ignoreReason(): void {}

function isNativePromiseBrand(value: PipeResult): boolean {
  try {
    return value instanceof Promise
  } catch {
    return false
  }
}

function observeOriginalRejection(value: PipeResult): boolean {
  if (!isNativePromiseBrand(value)) {
    return false
  }
  try {
    Reflect.apply(Promise.prototype.then, value, [swallow, ignoreReason])
    return true
  } catch {
    return false
  }
}

function mergeIntoContainer(
  state: PipeState,
  pipeline: PipelineBase,
  step: number,
  fnName: string,
  produced: PipeOutput,
  isInvocationInput: boolean,
): void {
  for (const key of Object.keys(produced as Record<string, PipeResult>)) {
    if (RESERVED_OUTPUT_NAMES.includes(key)) {
      throw new OutputNameError(
        `Pipeline [${pipeline.name}] step [${step}|${fnName}] : Output name "${key}" is reserved.`,
      )
    }
    if (!isInvocationInput && hasConfiguredDependency(pipeline.functions, key)) {
      throw new OutputNameError(
        `Pipeline [${pipeline.name}] step [${step}|${fnName}] : Output name "${key}" shadows a configured dependency of the same name.`,
      )
    }
    setEntry(state.container, key, (produced as Record<string, PipeResult>)[key])
  }
}

interface QueuedContinuation {
  error?: Error
  value?: PipeResult
  fromStep?: number
}

interface PipeState {
  step: 0
  container: ResultContainer

  args: PipeResult[]

  activeError: Error | null

  handlingError: boolean

  settled: boolean

  settling: boolean

  pending: number

  halted: boolean

  aborted: boolean

  nextRegistries: NextCallbacks[]

  driving: boolean

  queue: QueuedContinuation[]

  onSettled?: (outcome: { container: ResultContainer; error: Error | null }) => void

  pipeline: PipelineBase

  exit: PipelineExit | null

  exited: boolean
}

function recordExit(
  state: PipeState,
  via: PipelineExitVia,
  step: number | null,
  name: string | null,
  reason: PipeResult,
  error: unknown,
): void {
  if (state.exit != null) {
    return
  }
  state.exit = { via, step, name, reason, error }
}

function containHandler(invoke: () => unknown): void {
  let returned: unknown
  try {
    returned = invoke()
  } catch {
    return
  }
  if (returned == null || (typeof returned !== 'object' && typeof returned !== 'function')) {
    return
  }
  try {
    const thenFn = (returned as { then?: unknown }).then
    if (typeof thenFn === 'function') {
      Reflect.apply(thenFn as AnyFunction, returned, [swallow, ignoreReason])
    }
  } catch {}
}

export function dispatchExit(
  pipeline: PipelineBase,
  exit: PipelineExit,
  container: ResultContainer,
): void {
  const { reasonHandler, exitHandlers } = pipeline
  if (exit.via === 'reason' && reasonHandler) {
    containHandler((): unknown => reasonHandler(exit.reason, exit, container))
  }
  if (!exitHandlers) {
    return
  }
  for (const handler of exitHandlers) {
    containHandler((): unknown => handler(exit, container))
  }
}

export function dispatchAbortExit(pipeline: PipelineBase, error: unknown): void {
  dispatchExit(pipeline, { via: 'abort', step: null, name: null, error }, {})
}

function runExitHandlers(state: PipeState, error: unknown): void {
  if (state.exited) {
    return
  }
  state.exited = true
  recordExit(state, error == null ? 'value' : 'error', null, null, undefined, error)
  dispatchExit(state.pipeline, state.exit as PipelineExit, state.container)
}

function recordFailure(state: PipeState, error: unknown, failedStep?: number): void {
  const { pipes } = state.pipeline
  const known = failedStep !== undefined && failedStep >= 0 && failedStep < pipes.length
  recordExit(
    state,
    'error',
    known ? (failedStep as number) : null,
    known ? pipes[failedStep as number].fnName : null,
    undefined,
    error,
  )
}

function settle(state: PipeState, error: Error | null, failedStep?: number): void {
  if (error != null) {
    recordFailure(state, error, failedStep)
  }
  if (!state.onSettled) {
    runExitHandlers(state, error)
    return
  }
  if (error == null) {
    if (state.settled || state.settling) {
      return
    }
    state.settling = true
    Promise.resolve().then(() => {
      if (state.settled) {
        return
      }
      state.settled = true
      runExitHandlers(state, null)
      state.onSettled?.({ container: state.container, error: null })
    })
    return
  }

  if (state.settled) {
    return
  }

  if (state.activeError == null) {
    state.activeError = error
  }
  state.settled = true
  runExitHandlers(state, error)
  state.onSettled?.({ container: state.container, error })
}

function cancelRun(state: PipeState, reason: unknown): void {
  for (const callbacks of state.nextRegistries) {
    invalidateNextCallbacks(callbacks)
  }
  if (state.settled || state.aborted) {
    return
  }
  state.aborted = true
  const aborted = new PipelineAbortedError(reason)
  recordExit(state, 'abort', null, null, undefined, aborted)
  settle(state, aborted)
}

function haltRun(state: PipeState): void {
  state.halted = true
  for (const callbacks of state.nextRegistries) {
    invalidateNextCallbacks(callbacks)
  }
}

function executePipe(
  pipe: Pipe,
  state: PipeState,
  pipeline: PipelineBase,
  next: AnyFunction,
): void {
  const { fnName } = pipe
  const { container, args } = state
  const { functions } = pipeline

  const fn = pipe.injected
    ? Object.prototype.hasOwnProperty.call(container, fnName)
      ? container[fnName]
      : functions[fnName]
    : pipe.fn

  const nextCallbacks: NextCallbacks = {
    wrappers: [],
    holding: false,
    held: [],
    onConsumed: (): void => {
      state.pending -= 1
    },
    onError: (err: Error): boolean => {
      if (!state.onSettled) {
        return false
      }

      if (!state.settled) {
        settle(state, err, nextCallbacks.pipeIndex)
      }
      return true
    },
    pipeIndex: state.step - 1,
  }

  state.nextRegistries.push(nextCallbacks)
  const inputArgs = pipe.fetcher.fetch(container, args, functions, nextCallbacks)

  state.pending += nextCallbacks.wrappers.length

  if (state.aborted) {
    invalidateNextCallbacks(nextCallbacks)
    return
  }
  const advance = next as unknown as Continuation

  let result: PipeResult

  if (pipe.optional && (fn === undefined || pipe.fetcher.hasUnresolved(container, functions))) {
    invalidateNextCallbacks(nextCallbacks)
    advance(state, pipeline, null, undefined, -1)
    return
  } else if (typeof fn === 'function') {
    holdNextCallbacks(nextCallbacks)
    try {
      result = fn.apply(0, inputArgs as PipeResult[])
    } catch (err) {
      flushNextCallbacks(state, pipeline, advance, nextCallbacks)

      if (
        err instanceof NextCalledTwiceError ||
        err instanceof OutputNameError ||
        err instanceof OutputKeyError ||
        err instanceof AmbiguousContinuationError
      ) {
        throw err
      }

      if (state.handlingError) {
        state.handlingError = false
        throw err
      }

      advance(state, pipeline, (err || new Error('Pipe threw a falsey value')) as Error)
      return
    }
  } else if (typeof fn === 'boolean') {
    invalidateNextCallbacks(nextCallbacks)
    result = fn
  } else {
    throw new Error(
      `Pipeline [${pipeline.name}] step [${state.step}|${
        pipe.fnName
      }] : Dependency "${fnName}" is not a function or boolean.`,
    )
  }

  if (pipe.not && typeof result === 'boolean') {
    result = !result
  }

  const isFlowControl = pipe.not === true || typeof fn === 'boolean'

  let thenFn: unknown
  if (result !== null && (typeof result === 'object' || typeof result === 'function')) {
    try {
      thenFn = (result as { then?: unknown }).then
    } catch (err) {
      invalidateNextCallbacks(nextCallbacks)

      observeOriginalRejection(result)

      const failure = (err || new Error('Pipe promise rejected with a falsey value')) as Error
      Promise.reject(failure).catch((reason: Error): void => {
        advance(state, pipeline, reason)
      })
      return
    }
  }
  const thenable = typeof thenFn === 'function'

  if (pipe.fetcher.hasNext && thenable) {
    invalidateNextCallbacks(nextCallbacks)
    Promise.resolve().then(() => {
      observeOriginalRejection(result)
      try {
        Reflect.apply(thenFn as AnyFunction, result, [swallow, ignoreReason])
      } catch {}
    })
    throw new AmbiguousContinuationError(
      `Pipeline [${pipeline.name}] step [${state.step}|${pipe.fnName}] : Pipe declares "next" as an input and returned a thenable — use one continuation channel, not both.`,
    )
  }

  if (pipe.fetcher.hasNext === false && thenable) {
    const pipeIndex = state.step - 1

    state.pending += 1
    const onFulfilled = (value: PipeResult): void => {
      state.pending -= 1

      if (state.activeError != null || state.halted || state.aborted) {
        if (state.halted && !state.aborted && state.pending === 0) {
          settle(state, null)
        }
        return
      }

      let resolved = value
      if (pipe.not && typeof resolved === 'boolean') {
        resolved = !resolved
      }
      if (isFlowControl && resolved === false) {
        recordExit(state, 'halt', pipeIndex, pipe.fnName, undefined, null)
        state.halted = true
        if (state.pending === 0) {
          settle(state, null)
        }
        return
      }
      if (resolved == null) {
        try {
          pipe.producer.expectValue()
        } catch (err) {
          if (state.onSettled && !state.settled) {
            settle(state, err as Error, pipeIndex)
            return
          }
          throw err
        }
      }
      advance(state, pipeline, null, resolved, pipeIndex)
    }
    const onRejected = (reason: unknown): void => {
      state.pending -= 1
      if (state.activeError != null || state.halted || state.aborted) {
        if (state.halted && !state.aborted && state.pending === 0) {
          settle(state, null)
        }
        return
      }

      advance(
        state,
        pipeline,
        (reason || new Error('Pipe promise rejected with a falsey value')) as Error,
        undefined,
        pipeIndex,
      )
    }

    if (thenFn === Promise.prototype.then) {
      try {
        Reflect.apply(thenFn as AnyFunction, result, [onFulfilled, onRejected])
      } catch (err) {
        Promise.reject(err).catch(onRejected)
        observeOriginalRejection(result)
      }
      return
    }

    Promise.resolve(result).then(onFulfilled, onRejected)
    observeOriginalRejection(result)
    return
  }

  flushNextCallbacks(state, pipeline, advance, nextCallbacks)

  const ownsContinuation = pipe.fetcher.hasNext && typeof fn !== 'boolean'
  if (!ownsContinuation && !(isFlowControl && result === false)) {
    if (result == null) {
      pipe.producer.expectValue()
    }
    advance(state, pipeline, null, result)
  } else if (!ownsContinuation) {
    recordExit(state, 'halt', state.step - 1, pipe.fnName, undefined, null)
    state.halted = true
    if (state.pending === 0) {
      settle(state, null)
    }
  }
}

function next(
  state: PipeState,
  pipeline: PipelineBase,
  error?: Error,
  value?: PipeResult,
  fromStep?: number,
): void {
  if (state.settled) {
    return
  }

  if (state.driving) {
    state.queue.push({ error, value, fromStep })
    return
  }

  state.driving = true
  try {
    let cursor = 0
    for (;;) {
      try {
        continuePipeline(state, pipeline, error, value, fromStep)
      } catch (err) {
        if (!state.onSettled) {
          throw err
        }
        if (!state.settled) {
          settle(
            state,
            (err || new Error('Pipe continuation threw a falsey value')) as Error,
            fromStep === undefined ? state.step - 1 : fromStep,
          )
        }
      }
      if (state.settled || cursor >= state.queue.length) {
        break
      }
      const item = state.queue[cursor]
      cursor += 1
      error = item.error
      value = item.value
      fromStep = item.fromStep
    }
    state.queue.length = 0
  } finally {
    state.driving = false
  }
}

function continuePipeline(
  state: PipeState,
  pipeline: PipelineBase,
  error?: Error,
  value?: PipeResult,
  fromStep?: number,
): void {
  const { pipes, errorHandler } = pipeline
  const { step } = state

  if (state.halted || state.aborted) {
    if (state.halted && !state.aborted && state.pending === 0) {
      settle(state, null)
    }
    return
  }

  if (value != null) {
    const producerIndex = fromStep === undefined ? step - 1 : fromStep
    const producer = pipes[producerIndex].producer
    const result =
      producer.isResult && error == null
        ? producer.produceResult(value)
        : { output: producer.produce(value, error != null), terminal: false }
    mergeIntoContainer(
      state,
      pipeline,
      producerIndex,
      pipes[producerIndex].fnName,
      result.output,
      false,
    )
    if (result.terminal) {
      recordExit(
        state,
        'reason',
        producerIndex,
        pipes[producerIndex].fnName,
        Object.values(result.output as ResultContainer)[0],
        null,
      )
      haltRun(state)
    }
  }

  if (error != null) {
    const failedIndex = fromStep === undefined ? step - 1 : fromStep
    const failed = failedIndex >= 0 && failedIndex < pipes.length ? pipes[failedIndex] : null
    recordExit(
      state,
      'error',
      failed ? failedIndex : null,
      failed ? failed.fnName : null,
      undefined,
      error,
    )
    state.activeError = error
  }

  if (state.activeError == null) {
    state.handlingError = false
    if (state.aborted) {
      return
    }
    if (state.halted) {
      if (state.pending === 0) {
        settle(state, null)
      }
      return
    }
    if (state.pending > 0) {
      return
    }
    if (pipes.length > state.step) {
      executePipe(pipes[state.step++], state, pipeline, next)
    } else {
      settle(state, null)
    }
    return
  }

  state.handlingError = true

  settle(state, state.activeError)
  if (errorHandler) {
    ;(errorHandler as ErrorHandler)(state.container, pipeline.functions, state.activeError)
  } else if (!state.onSettled) {
    throwNoErrorHandlerError(state.activeError)
  }
}

export function runPipeline(
  args: PipeResult,
  pipeline: PipelineBase,
  onSettled?: (outcome: { container: ResultContainer; error: Error | null }) => void,
  registerCancel?: (cancel: (reason: unknown) => void) => void,
): ResultContainer {
  const state: PipeState = {
    step: 0,

    container: {
      next: (error?: Error, value?: PipeResult, fromStep?: number): void => {
        next(state, pipeline, error, value, fromStep)
      },
    },
    args: Array.isArray(args) ? args : args === undefined ? [] : [args],
    activeError: null,
    handlingError: false,
    settled: false,
    settling: false,
    pending: 0,
    halted: false,
    aborted: false,
    nextRegistries: [],
    driving: false,
    queue: [],
    onSettled,
    pipeline,
    exit: null,
    exited: false,
  }

  registerCancel?.((reason: unknown): void => {
    cancelRun(state, reason)
  })

  try {
    for (const inputPipe of pipeline.inputPipes || []) {
      mergeIntoContainer(
        state,
        pipeline,
        0,
        inputPipe.fnName,
        inputPipe.producer.produce(state.args),
        true,
      )
    }

    next(state, pipeline)
  } catch (err) {
    const thrown = (err || new Error('Pipeline threw a falsey value')) as Error
    const failedIndex = state.step - 1
    const failed =
      failedIndex >= 0 && failedIndex < pipeline.pipes.length ? pipeline.pipes[failedIndex] : null
    recordExit(
      state,
      'error',
      failed ? failedIndex : null,
      failed ? failed.fnName : null,
      undefined,
      thrown,
    )
    runExitHandlers(state, thrown)
    throw err
  }

  return state.container
}
