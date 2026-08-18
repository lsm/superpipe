import {
  AmbiguousContinuationError,
  type AnyFunction,
  type FunctionContainer,
  NextCalledTwiceError,
  OutputNameError,
  PipelineAbortedError,
  type PipelineBase,
  type PipeOutput,
  type PipeResult,
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

interface ResultContainer {
  [key: string]: PipeResult
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
  }
  Object.assign(state.container, produced)
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
}

function settle(state: PipeState, error: Error | null): void {
  if (!state.onSettled) {
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
  settle(state, new PipelineAbortedError(reason))
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
        settle(state, err)
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
    advance(state, pipeline)
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

      if (state.activeError != null) {
        return
      }

      let resolved = value
      if (pipe.not && typeof resolved === 'boolean') {
        resolved = !resolved
      }
      if (isFlowControl && resolved === false) {
        state.halted = true
        if (state.pending === 0) {
          settle(state, null)
        }
        return
      }
      advance(state, pipeline, null, resolved, pipeIndex)
    }
    const onRejected = (reason: unknown): void => {
      state.pending -= 1
      if (state.activeError != null) {
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
      let settled = false
      const settleFulfilled = (value: PipeResult): void => {
        if (settled) {
          return
        }
        settled = true
        onFulfilled(value)
      }
      const settleRejected = (reason: unknown): void => {
        if (settled) {
          return
        }
        settled = true
        onRejected(reason)
      }
      try {
        Reflect.apply(thenFn as AnyFunction, result, [settleFulfilled, settleRejected])
      } catch (err) {
        if (!settled) {
          settled = true
          Promise.reject(err).catch(onRejected)
        }
        observeOriginalRejection(result)
      }
      return
    }

    new Promise<PipeResult>((resolve, reject) => {
      Promise.resolve().then(() => {
        try {
          Reflect.apply(thenFn as AnyFunction, result, [resolve, reject])
        } catch (err) {
          reject(err)
        }

        observeOriginalRejection(result)
      })
    }).then(onFulfilled, onRejected)
    return
  }

  flushNextCallbacks(state, pipeline, advance, nextCallbacks)

  const ownsContinuation = pipe.fetcher.hasNext && typeof fn !== 'boolean'
  if (!ownsContinuation && !(isFlowControl && result === false)) {
    advance(state, pipeline, null, result)
  } else if (!ownsContinuation) {
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
    for (;;) {
      try {
        continuePipeline(state, pipeline, error, value, fromStep)
      } catch (err) {
        if (!state.onSettled) {
          throw err
        }
        if (!state.settled) {
          settle(state, (err || new Error('Pipe continuation threw a falsey value')) as Error)
        }
      }
      if (state.settled) {
        break
      }
      const item = state.queue.shift()
      if (!item) {
        break
      }
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

  if (value != null) {
    const producerIndex = fromStep === undefined ? step - 1 : fromStep
    mergeIntoContainer(
      state,
      pipeline,
      producerIndex,
      pipes[producerIndex].fnName,
      pipes[producerIndex].producer.produce(value),
      false,
    )
  }

  if (error != null) {
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
  }

  registerCancel?.((reason: unknown): void => {
    cancelRun(state, reason)
  })

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

  return state.container
}
