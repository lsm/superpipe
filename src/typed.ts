import type {
  AbortSignalLike,
  ExitHandler,
  FunctionContainer,
  PipelineExit,
  Result,
  ResultContainer,
} from './common'
import PipelineBuilder from './pipeline/Pipeline'

export interface TypedState {
  deps: object
  args: readonly unknown[]
  ctx: object
  gates: object
  skipped: string
  late: string
  stopped: boolean
  async: boolean
  started: boolean
  handled: boolean
  observed: boolean
}

export interface TypedError<Message extends string> {
  readonly problem: Message
}

type Empty = Record<never, never>

type Flat<T> = { [K in keyof T]: T[K] }

type Merge<A, B> = Flat<Omit<A, keyof B> & B>

type Keys<T> = keyof T & string

type Either<A extends boolean, B extends boolean> = A extends true ? true : B

type IsAny<T> = 0 extends 1 & T ? true : false

type IsAsync<R> =
  IsAny<R> extends true ? false : [Extract<R, PromiseLike<unknown>>] extends [never] ? false : true

type RequiredKeys<V> = {
  [K in keyof V]-?: Record<never, never> extends Pick<V, K> ? never : K
}[keyof V]

type IsOpen<D> = string extends Keys<D> ? true : false

type ReservedOutput<S extends TypedState> =
  | 'next'
  | (IsOpen<S['deps']> extends true ? never : Keys<S['deps']>)

type Checked<Problem, Ok> = [Problem] extends [never] ? Ok : TypedError<Problem & string>

export type TypedNext = (error?: unknown, value?: unknown) => void

type KnownName<S extends TypedState> = Keys<S['ctx']> | Keys<S['deps']>

type InputName<S extends TypedState> = KnownName<S> | 'next'

type InputValue<S extends TypedState, K> = K extends 'next'
  ? TypedNext
  : K extends Keys<S['ctx']>
    ? S['ctx'][K] | (K extends S['skipped'] ? undefined : never)
    : K extends Keys<S['deps']>
      ? S['deps'][K]
      : never

export type InputSpec<S extends TypedState> =
  | InputName<S>
  | readonly InputName<S>[]
  | null
  | undefined

type InputTuple<S extends TypedState, K> = K extends readonly string[]
  ? [...{ [I in keyof K]: InputValue<S, K[I]> }]
  : K extends string
    ? [InputValue<S, K>]
    : [...S['args']]

type UsesNext<K> = K extends readonly string[]
  ? 'next' extends K[number]
    ? true
    : false
  : K extends 'next'
    ? true
    : false

type Produced<K, R> = UsesNext<K> extends true ? unknown : R

export type OutputSpec = string | readonly string[] | undefined

type ValueArm<R> = Extract<R, { value: unknown }>['value']

type ReasonArm<R> = Extract<R, { reason: unknown }>['reason']

type Positional<O extends readonly string[], V extends readonly unknown[]> = {
  [I in keyof O as I extends `${number}`
    ? O[I] extends string
      ? O[I]
      : never
    : never]: I extends keyof V ? V[I] : V[number]
}

type FitsTuple<
  O extends readonly string[],
  V extends readonly unknown[],
> = number extends V['length'] ? true : O['length'] extends Partial<V>['length'] ? true : false

type IsPlainObject<V> = V extends AnyCallable
  ? false
  : V extends readonly unknown[]
    ? false
    : V extends object
      ? [Keys<V>] extends [never]
        ? false
        : true
      : false

type IsEmptyArray<K> = K extends readonly [] ? true : false

type Picked<O extends readonly string[], V> = {
  [K in O[number]]: K extends keyof V ? V[K] : never
}

type Destructured<O extends readonly string[], V> = V extends readonly unknown[]
  ? Positional<O, V>
  : Picked<O, V>

type Bound<O, R> = O extends `result:${infer N}`
  ? { [P in N]: ValueArm<Awaited<R>> }
  : O extends '{...}'
    ? Awaited<R>
    : O extends readonly string[]
      ? Destructured<O, Awaited<R>>
      : O extends string
        ? { [P in O]: Awaited<R> }
        : Empty

type GateBindings<S extends TypedState, O, R> = O extends `result:${infer N}`
  ? Merge<
      S['gates'],
      {
        [P in N]: (N extends Keys<S['gates']> ? S['gates'][N] : never) | ReasonArm<Awaited<R>>
      }
    >
  : S['gates']

type IsGate<O> = O extends `result:${string}` ? true : false

interface Change {
  add: unknown
  optional: boolean
  stop: boolean
  async: boolean
  gates: object
  start: boolean
}

type Bind<S extends TypedState, C extends Change> = {
  deps: S['deps']
  args: S['args']
  ctx: Merge<S['ctx'], C['add']>
  gates: C['gates']
  skipped:
    | Exclude<S['skipped'], Keys<C['add']>>
    | (C['optional'] extends true ? Keys<C['add']> : never)
  late: S['late'] | (S['stopped'] extends true ? Keys<C['add']> : never)
  stopped: Either<S['stopped'], C['stop']>
  async: Either<S['async'], C['async']>
  started: Either<S['started'], C['start']>
  handled: S['handled']
  observed: S['observed']
}

type SetFlag<S extends TypedState, F extends 'handled' | 'observed'> = Flat<
  Omit<S, F> & { [P in F]: true }
>

type NotTypedElement = `{${string}}` | `${string}:${string}`

type GateNeedsResult = 'A "result:<name>" output requires the pipe to return { value } | { reason }'

type SpreadNeedsObject = 'A "{...}" output requires the pipe to return a plain object'

type NotTypedYet =
  'Brace picks and src:dst renames are not typed yet; use an array output or a single name'

type ReservedName = 'This output name is reserved or shadows a configured dependency'

type DestructureMismatch =
  'An array output requires the pipe to return an array or an object with every named key'

type DestructureTooLong = 'An array output names more positions than the returned tuple has'

type EmptyNames = 'An input, output, or end spec cannot be an empty array'

type InterceptedName =
  'The names "input" and "error" are dispatched to .input() and .error() by the runtime; rename the dependency'

type OptionalKey =
  'An array output names an optional property; the runtime throws when it is absent'

type OutputProblem<S extends TypedState, O, R> = O extends undefined
  ? never
  : O extends `result:${infer N}`
    ? N extends ReservedOutput<S>
      ? ReservedName
      : IsAny<Awaited<R>> extends true
        ? never
        : Awaited<R> extends Result<unknown, unknown>
          ? never
          : GateNeedsResult
    : O extends '{...}'
      ? IsAny<Awaited<R>> extends true
        ? never
        : IsPlainObject<Awaited<R>> extends true
          ? [Keys<Awaited<R>> & ReservedOutput<S>] extends [never]
            ? never
            : ReservedName
          : SpreadNeedsObject
      : O extends `{${string}}` | `${string}:${string}`
        ? NotTypedYet
        : O extends readonly string[]
          ? IsEmptyArray<O> extends true
            ? EmptyNames
            : [Extract<O[number], NotTypedElement>] extends [never]
              ? [O[number] & ReservedOutput<S>] extends [never]
                ? IsAny<Awaited<R>> extends true
                  ? never
                  : Awaited<R> extends readonly unknown[]
                    ? FitsTuple<O, Awaited<R>> extends true
                      ? never
                      : DestructureTooLong
                    : O[number] extends keyof Awaited<R>
                      ? O[number] extends RequiredKeys<Awaited<R>>
                        ? never
                        : OptionalKey
                      : DestructureMismatch
                : ReservedName
              : NotTypedYet
          : O extends ReservedOutput<S>
            ? ReservedName
            : never

type AfterFunctionPipe<S extends TypedState, K, O, R> = Bind<
  S,
  {
    add: Bound<O, Produced<K, R>>
    optional: false
    stop: IsGate<O>
    async: Either<IsAsync<R>, UsesNext<K>>
    gates: GateBindings<S, O, Produced<K, R>>
    start: true
  }
>

type Sigils<N> = N extends `!${infer Rest}`
  ? Rest extends `?${infer Base}`
    ? { base: Base; not: true; optional: true }
    : { base: Rest; not: true; optional: false }
  : N extends `?${infer Base}`
    ? { base: Base; not: false; optional: true }
    : { base: N; not: false; optional: false }

type InjectedSpec<S extends TypedState> =
  | KnownName<S>
  | `!${KnownName<S>}`
  | `?${string}`
  | `!?${string}`

type Resolved<S extends TypedState, N> = InputValue<S, Sigils<N>['base']>

type AnyCallable = (...args: never[]) => unknown

type Callable<F> = [F] extends [never]
  ? (...args: unknown[]) => unknown
  : F extends AnyCallable
    ? F
    : never

type IsFlowControl<F, Not extends boolean> = Not extends true
  ? true
  : [F] extends [never]
    ? false
    : [F] extends [boolean]
      ? true
      : false

type InjectedReturn<S extends TypedState, N> = ReturnType<Callable<Resolved<S, N>>>

type InjectedResult<S extends TypedState, N, K> = Produced<K, InjectedReturn<S, N>>

type InjectedInputMismatch =
  'The declared inputs do not match the parameters of the injected function'

type InjectedNotCallable = 'This dependency is neither a function nor a boolean'

type InjectedKindProblem<S extends TypedState, N> = N extends 'input' | 'error'
  ? InterceptedName
  : [Resolved<S, N>] extends [never]
    ? never
    : [Resolved<S, N>] extends [boolean]
      ? never
      : Resolved<S, N> extends AnyCallable
        ? never
        : InjectedNotCallable

type EmptyNamesProblem<K> = IsEmptyArray<K> extends true ? EmptyNames : never

type InjectedInputProblem<S extends TypedState, N, K> = K extends undefined | null
  ? never
  : IsFlowControl<Resolved<S, N>, Sigils<N>['not']> extends true
    ? never
    : [InputTuple<S, K>] extends [Parameters<Callable<Resolved<S, N>>>]
      ? never
      : InjectedInputMismatch

type AfterInjectedPipe<S extends TypedState, N, K, O> =
  IsFlowControl<Resolved<S, N>, Sigils<N>['not']> extends true
    ? Bind<
        S,
        {
          add: Empty
          optional: false
          stop: true
          async: IsAsync<InjectedReturn<S, N>>
          gates: S['gates']
          start: true
        }
      >
    : Bind<
        S,
        {
          add: Bound<O, InjectedResult<S, N, K>>
          optional: Sigils<N>['optional']
          stop: IsGate<O>
          async: Either<IsAsync<InjectedReturn<S, N>>, UsesNext<K>>
          gates: GateBindings<S, O, InjectedResult<S, N, K>>
          start: true
        }
      >

type ArgAt<Args extends readonly unknown[], I> = I extends keyof Args
  ? Args[I]
  : number extends Args['length']
    ? Args[number] | undefined
    : undefined

type InputBindings<S extends TypedState, K> = K extends readonly string[]
  ? {
      [I in keyof K as I extends `${number}` ? (K[I] extends string ? K[I] : never) : never]: ArgAt<
        S['args'],
        I
      >
    }
  : K extends string
    ? { [P in K]: ArgAt<S['args'], '0'> }
    : Empty

type InputNamesProblem<K> = K extends `{${string}}`
  ? NotTypedYet
  : K extends 'next'
    ? ReservedName
    : K extends readonly string[]
      ? IsEmptyArray<K> extends true
        ? EmptyNames
        : 'next' extends K[number]
          ? ReservedName
          : never
      : never

type AfterInput<S extends TypedState, K> = Bind<
  S,
  {
    add: InputBindings<S, K>
    optional: false
    stop: false
    async: false
    gates: S['gates']
    start: false
  }
>

type ErrorInputName<S extends TypedState> = 'error' | KnownName<S>

type ErrorValue<S extends TypedState, K> = K extends 'error'
  ? unknown
  : K extends Keys<S['ctx']>
    ? S['ctx'][K] | undefined
    : K extends Keys<S['deps']>
      ? S['deps'][K]
      : never

type ErrorTuple<S extends TypedState, K> = K extends readonly string[]
  ? [...{ [I in keyof K]: ErrorValue<S, K[I]> }]
  : K extends string
    ? [ErrorValue<S, K>]
    : [unknown]

type Reasons<S extends TypedState> = S['gates'][Keys<S['gates']>]

type EndSpec<S extends TypedState> = KnownName<S> | readonly KnownName<S>[]

type EndSingle<S extends TypedState, N> =
  N extends Keys<S['ctx']>
    ?
        | S['ctx'][N]
        | (N extends Keys<S['gates']> ? S['gates'][N] : never)
        | (N extends S['skipped'] | S['late'] ? undefined : never)
    : N extends Keys<S['deps']>
      ? S['deps'][N]
      : never

type EndValue<S extends TypedState, O> = O extends readonly string[]
  ? [...{ [I in keyof O]: EndSingle<S, O[I]> }]
  : EndSingle<S, O>

type SyncRunner<S extends TypedState, Out> = (...args: [...S['args']]) => Out

type SyncEndUnavailable = 'This pipeline has an async pipe; use endAsync()'

interface SyncEnd<S extends TypedState> {
  (): SyncRunner<S, undefined>
  <const O extends EndSpec<S>>(
    output: O,
  ): Checked<EmptyNamesProblem<O>, SyncRunner<S, EndValue<S, O>>>
}

interface SyncEndWhenAsync<S extends TypedState> {
  (): SyncRunner<S, undefined>
  (output: SyncEndUnavailable): never
}

export interface TypedAsyncRunner<Args extends readonly unknown[], Out> {
  (...args: [...Args]): Promise<Out>
  withSignal(signal: AbortSignalLike, ...args: [...Args]): Promise<Out>
}

type InputAfterPipe = 'An input pipe must come before the first pipe'

type PipeAfterError = 'Adding a pipe after the error handler is not allowed'

type SecondErrorHandler = 'Each pipeline can have only one error handler'

type SecondReasonHandler = 'Each pipeline can have only one reason handler'

type InputMethod<S extends TypedState> = <const K extends string | readonly string[]>(
  names: K,
) => Checked<InputNamesProblem<K>, TypedPipeline<AfterInput<S, K>>>

interface PipeMethod<S extends TypedState> {
  <
    const N extends InjectedSpec<S>,
    const K extends InputSpec<S> = undefined,
    const O extends OutputSpec = undefined,
  >(
    name: N,
    input?: K,
    output?: O,
  ): Checked<
    | InjectedKindProblem<S, N>
    | EmptyNamesProblem<K>
    | InjectedInputProblem<S, N, K>
    | OutputProblem<S, O, InjectedResult<S, N, K>>,
    TypedPipeline<AfterInjectedPipe<S, N, K, O>>
  >

  <R, const K extends InputSpec<S> = undefined, const O extends OutputSpec = undefined>(
    fn: (...args: InputTuple<S, K>) => R,
    input?: K,
    output?: O,
  ): Checked<
    EmptyNamesProblem<K> | OutputProblem<S, O, Produced<K, R>>,
    TypedPipeline<AfterFunctionPipe<S, K, O, R>>
  >
}

type ErrorMethod<S extends TypedState> = <
  const K extends ErrorInputName<S> | readonly ErrorInputName<S>[] = 'error',
>(
  handler: ((...args: ErrorTuple<S, K>) => unknown) | Keys<S['deps']>,
  input?: K,
) => Checked<EmptyNamesProblem<K>, TypedPipeline<SetFlag<S, 'handled'>>>

type ReasonMethod<S extends TypedState> = (
  handler: (reason: Reasons<S>, exit: PipelineExit, container: ResultContainer) => unknown,
) => TypedPipeline<SetFlag<S, 'observed'>>

export interface TypedPipeline<S extends TypedState> {
  readonly input: S['started'] extends true ? (names: InputAfterPipe) => never : InputMethod<S>

  readonly pipe: S['handled'] extends true ? (fn: PipeAfterError) => never : PipeMethod<S>

  readonly error: S['handled'] extends true
    ? (handler: SecondErrorHandler) => never
    : ErrorMethod<S>

  readonly reason: S['observed'] extends true
    ? (handler: SecondReasonHandler) => never
    : ReasonMethod<S>

  onExit(handler: ExitHandler): TypedPipeline<S>

  readonly end: S['async'] extends true ? SyncEndWhenAsync<S> : SyncEnd<S>

  endAsync(): TypedAsyncRunner<S['args'], undefined>
  endAsync<const O extends EndSpec<S>>(
    output: O,
  ): Checked<EmptyNamesProblem<O>, TypedAsyncRunner<S['args'], EndValue<S, O>>>
}

type InitialState<D extends object, Args extends readonly unknown[]> = {
  deps: D
  args: Args
  ctx: Empty
  gates: Empty
  skipped: never
  late: never
  stopped: false
  async: false
  started: false
  handled: false
  observed: false
}

export type TypedFactory<D extends object> = <Args extends readonly unknown[] = unknown[]>(
  name: string,
) => TypedPipeline<InitialState<D, Args>>

export function typed<D extends object = Empty>(deps?: D): TypedFactory<D> {
  const factory = (name: string): PipelineBuilder =>
    new PipelineBuilder(name, deps as FunctionContainer | undefined)
  return factory as unknown as TypedFactory<D>
}
