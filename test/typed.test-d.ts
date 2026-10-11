import { describe, expectTypeOf, it } from 'vitest'
import superpipe, { type PipelineAPI, type Result, type TypedError, typed } from '../src'

interface User {
  id: string
  name: string
}

interface Receipt {
  total: number
}

type Denied = { code: 'denied' }

const deps = {
  isBlocked: false,
  loadUser: (id: string): User => ({ id, name: 'ada' }),
  fetchUser: (id: string): Promise<User> => Promise.resolve({ id, name: 'ada' }),
}

const tp = typed(deps)

type Problem = TypedError<string>

describe('typed input', () => {
  it('binds positional args to names and types the runner parameters', () => {
    const run = tp<[string, number]>('p')
      .input(['id', 'count'])
      .pipe((id, count) => ({ id, count }), ['id', 'count'], 'pair')
      .endAsync('pair')
    expectTypeOf(run).parameters.toEqualTypeOf<[string, number]>()
    expectTypeOf(run).returns.resolves.toEqualTypeOf<{ id: string; count: number }>()
    expectTypeOf(run.withSignal).parameter(1).toEqualTypeOf<string>()
  })

  it('types a single input name from the first arg', () => {
    tp<[User]>('p')
      .input('user')
      .pipe((user) => expectTypeOf(user).toEqualTypeOf<User>(), 'user')
  })

  it('rejects next and brace forms as input names', () => {
    expectTypeOf(tp('p').input('next')).toExtend<Problem>()
    expectTypeOf(tp('p').input(['a', 'next'])).toExtend<Problem>()
    expectTypeOf(tp('p').input('{a, b}')).toExtend<Problem>()
  })
})

describe('typed pipe', () => {
  it('checks fn parameters against the context positionally', () => {
    tp<[string]>('p')
      .input('id')
      // @ts-expect-error id is a string, not a number
      .pipe((id: number) => id, 'id', 'n')
  })

  it('rejects unknown input names', () => {
    // @ts-expect-error nope is not in the context or deps
    tp('p').pipe((x: unknown) => x, 'nope')
  })

  it('reads configured dependencies by name', () => {
    tp('p').pipe(
      (loadUser) => expectTypeOf(loadUser).toEqualTypeOf<typeof deps.loadUser>(),
      ['loadUser'],
    )
  })

  it('passes the invocation args when no input is declared', () => {
    tp<[string, number]>('p').pipe((...args) =>
      expectTypeOf(args).toEqualTypeOf<[string, number]>(),
    )
  })

  it('binds a single output name to the awaited return', () => {
    tp('p')
      .pipe(() => Promise.resolve(1), null, 'n')
      .pipe((n) => expectTypeOf(n).toEqualTypeOf<number>(), 'n')
  })

  it('destructures tuple returns positionally and object returns by name', () => {
    tp('p')
      .pipe(() => ['a', 1] as const, null, ['first', 'second'])
      .pipe(
        (second, first) => {
          expectTypeOf(first).toEqualTypeOf<'a'>()
          expectTypeOf(second).toEqualTypeOf<1>()
        },
        ['second', 'first'],
      )
    tp('p')
      .pipe(() => ({ id: 'u', name: 'ada', extra: true }), null, ['id', 'name'])
      .pipe((name) => expectTypeOf(name).toEqualTypeOf<string>(), 'name')
    expectTypeOf(tp('p').pipe(() => ({ id: 'u' }), null, ['id', 'missing'])).toExtend<Problem>()
  })

  it('rejects spread outputs that are not plain objects', () => {
    expectTypeOf(tp('p').pipe(() => () => 1, null, '{...}')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => [1], null, '{...}')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => ({}), null, '{...}')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => new Date(), null, '{...}')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => new Map<string, number>(), null, '{...}')).toExtend<Problem>()
    class OnlyMethods {
      run(): number {
        return 1
      }
    }
    expectTypeOf(tp('p').pipe(() => new OnlyMethods(), null, '{...}')).toExtend<Problem>()
  })

  it('checks array outputs against the tuple length and types open arrays', () => {
    expectTypeOf(tp('p').pipe(() => ['a'] as const, null, ['first', 'second'])).toExtend<Problem>()
    tp('p')
      .pipe((): string[] => ['a', 'b'], null, ['first', 'second'])
      .pipe((first) => expectTypeOf(first).toEqualTypeOf<string>(), 'first')
  })

  it('rejects empty arrays wherever the runtime would throw', () => {
    expectTypeOf(tp('p').input([])).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => 1, [])).toExtend<Problem>()
    expectTypeOf(tp('p').pipe('loadUser', [])).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => 1, null, [])).toExtend<Problem>()
    expectTypeOf(tp('p').error(() => undefined, [])).toExtend<Problem>()
    expectTypeOf(tp('p').end([])).toExtend<Problem>()
    expectTypeOf(tp('p').endAsync([])).toExtend<Problem>()
  })

  it('refuses dependencies named input or error as injected pipes', () => {
    const clashing = typed({ input: () => 1, error: () => 2 })
    expectTypeOf(clashing('p').pipe('input', null, 'a')).toExtend<Problem>()
    expectTypeOf(clashing('p').pipe('error', null, 'b')).toExtend<Problem>()
  })

  it('treats any-returning functions as sync and skips return-shape checks', () => {
    const parse = (text: string): any => JSON.parse(text)
    const run = tp<[string]>('p').input('text').pipe(parse, 'text', 'data').end('data')
    expectTypeOf(run).returns.toBeAny()
    tp<[string]>('p').input('text').pipe(parse, 'text', 'result:data').endAsync('data')
    tp<[string]>('p').input('text').pipe(parse, 'text', '{...}')
    tp<[string]>('p').input('text').pipe(parse, 'text', ['a', 'b'])
  })

  it('rejects array outputs that name optional properties', () => {
    expectTypeOf(tp('p').pipe((): { a?: string } => ({}), null, ['a'])).toExtend<Problem>()
    tp('p')
      .pipe((): { a: string | undefined } => ({ a: undefined }), null, ['a'])
      .pipe((a) => expectTypeOf(a).toEqualTypeOf<string | undefined>(), 'a')
  })

  it('rejects empty and malformed spec strings', () => {
    expectTypeOf(tp('p').input('')).toExtend<Problem>()
    expectTypeOf(tp('p').input([''])).toExtend<Problem>()
    expectTypeOf(tp('p').input(['{a}'])).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => 1, null, '')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => [1], null, [''])).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => ({ value: 1 }), null, 'result:')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => ({ value: 1 }), null, 'result:a:b')).toExtend<Problem>()
  })

  it('merges every key of a spread output', () => {
    tp('p')
      .pipe(() => ({ ok: true, total: 2 }), null, '{...}')
      .pipe(
        (ok, total) => {
          expectTypeOf(ok).toEqualTypeOf<boolean>()
          expectTypeOf(total).toEqualTypeOf<number>()
        },
        ['ok', 'total'],
      )
    expectTypeOf(tp('p').pipe(() => 1, null, '{...}')).toExtend<Problem>()
  })

  it('rejects outputs that are reserved or shadow a dependency', () => {
    expectTypeOf(tp('p').pipe(() => 1, null, 'next')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => 1, null, 'isBlocked')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => ({ loadUser: 1 }), null, '{...}')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => ['x'], null, ['loadUser'])).toExtend<Problem>()
  })

  it('does not type brace picks or renames yet, inside arrays included', () => {
    expectTypeOf(tp('p').pipe(() => ({ a: 1 }), null, '{a}')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => ({ a: 1 }), null, 'a:b')).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => ({ a: 1 }), null, ['a:b'])).toExtend<Problem>()
    expectTypeOf(tp('p').pipe(() => [1], null, ['{a}'])).toExtend<Problem>()
  })

  it('types next as a callback and binds its output as unknown', () => {
    tp('p')
      .pipe(
        (next) => {
          expectTypeOf(next).parameters.toEqualTypeOf<[unknown?, unknown?]>()
          next(null, 1)
        },
        'next',
        'later',
      )
      .pipe((later) => expectTypeOf(later).toEqualTypeOf<unknown>(), 'later')
  })
})

describe('result gates', () => {
  const gate = (id: string): Result<User, Denied> =>
    id ? { value: { id, name: 'ada' } } : { reason: { code: 'denied' } }

  it('binds the value arm inside the pipeline', () => {
    tp<[string]>('p')
      .input('id')
      .pipe(gate, 'id', 'result:user')
      .pipe((user) => expectTypeOf(user).toEqualTypeOf<User>(), 'user')
  })

  it('ends on the gate name as value or reason, with no undefined', () => {
    const run = tp<[string]>('p')
      .input('id')
      .pipe(gate, 'id', 'result:user')
      .pipe((user): Receipt => ({ total: user.id.length }), 'user', 'receipt')
      .endAsync('user')
    expectTypeOf(run).returns.resolves.toEqualTypeOf<User | Denied>()
  })

  it('marks outputs produced after a gate as possibly undefined at the end', () => {
    const run = tp<[string]>('p')
      .input('id')
      .pipe(gate, 'id', 'result:user')
      .pipe((user): Receipt => ({ total: user.id.length }), 'user', 'receipt')
      .endAsync('receipt')
    expectTypeOf(run).returns.resolves.toEqualTypeOf<Receipt | undefined>()
  })

  it('unions the reasons of every gate for the reason handler', () => {
    const second = (): Result<number, 'late'> => ({ value: 1 })
    tp<[string]>('p')
      .input('id')
      .pipe(gate, 'id', 'result:user')
      .pipe(second, null, 'result:count')
      .reason((reason) => expectTypeOf(reason).toEqualTypeOf<Denied | 'late'>())
  })

  it('accepts promise-returning gates', () => {
    const asyncGate = async (): Promise<Result<User, Denied>> => ({ reason: { code: 'denied' } })
    const run = tp('p').pipe(asyncGate, null, 'result:user').endAsync('user')
    expectTypeOf(run).returns.resolves.toEqualTypeOf<User | Denied>()
  })

  it('requires a result-shaped return', () => {
    expectTypeOf(tp('p').pipe(() => ({ id: 'u' }), null, 'result:user')).toExtend<Problem>()
  })
})

describe('flow control and optional pipes', () => {
  it('marks outputs after a boolean dependency halt as possibly undefined at the end', () => {
    const run = tp('p')
      .pipe('isBlocked')
      .pipe(() => 1, null, 'n')
      .end('n')
    expectTypeOf(run).returns.toEqualTypeOf<number | undefined>()
  })

  it('treats a not-prefixed pipe as flow control', () => {
    const run = tp('p')
      .pipe('!isBlocked')
      .pipe(() => 1, null, 'n')
      .end('n')
    expectTypeOf(run).returns.toEqualTypeOf<number | undefined>()
  })

  it('keeps outputs produced before a halt defined at the end', () => {
    const run = tp('p')
      .pipe(() => 1, null, 'n')
      .pipe('isBlocked')
      .end('n')
    expectTypeOf(run).returns.toEqualTypeOf<number>()
  })

  it('makes an optional pipe output possibly undefined inside and at the end', () => {
    const run = tp<[string]>('p')
      .input('id')
      .pipe('?loadUser', 'id', 'user')
      .pipe((user) => expectTypeOf(user).toEqualTypeOf<User | undefined>(), 'user')
      .end('user')
    expectTypeOf(run).returns.toEqualTypeOf<User | undefined>()
  })
})

describe('injected function pipes', () => {
  it('binds the dependency return type and checks declared inputs', () => {
    tp<[string]>('p')
      .input('id')
      .pipe('loadUser', 'id', 'user')
      .pipe((user) => expectTypeOf(user).toEqualTypeOf<User>(), 'user')
    expectTypeOf(tp<[number]>('p').input('n').pipe('loadUser', 'n', 'user')).toExtend<Problem>()
  })

  it('rejects dependencies that are neither functions nor booleans', () => {
    const withConfig = typed({ config: { retries: 3 } })
    expectTypeOf(withConfig('p').pipe('config', null, 'c')).toExtend<Problem>()
    expectTypeOf(withConfig('p').pipe('!config')).toExtend<Problem>()
    expectTypeOf(withConfig('p').pipe('?config', null, 'c')).toExtend<Problem>()
  })

  it('checks the invocation args against an injected function when no input is declared', () => {
    expectTypeOf(tp<[number]>('p').pipe('loadUser', undefined, 'user')).toExtend<Problem>()
    tp<[string]>('p')
      .pipe('loadUser', undefined, 'user')
      .pipe((user) => expectTypeOf(user).toEqualTypeOf<User>(), 'user')
  })

  it('rejects unknown dependency names unless optional', () => {
    // @ts-expect-error nope is not a dependency
    tp('p').pipe('nope')
    tp('p')
      .pipe('?nope', null, 'maybe')
      .pipe((maybe) => expectTypeOf(maybe).toBeUnknown(), 'maybe')
  })

  it('tracks async dependencies', () => {
    const p = tp<[string]>('p').input('id').pipe('fetchUser', 'id', 'user')
    // @ts-expect-error sync end is unavailable once a pipe is async
    p.end('user')
    expectTypeOf(p.endAsync('user')).returns.resolves.toEqualTypeOf<User>()
  })
})

describe('end', () => {
  it('returns the fetched value synchronously for sync pipelines', () => {
    const run = tp<[string]>('p')
      .input('id')
      .pipe((id) => id.length, 'id', 'n')
      .end('n')
    expectTypeOf(run).toEqualTypeOf<(id: string) => number>()
  })

  it('returns a tuple for an array output', () => {
    const run = tp<[string]>('p')
      .input('id')
      .pipe((id) => id.length, 'id', 'n')
      .end(['id', 'n'])
    expectTypeOf(run).returns.toEqualTypeOf<[string, number]>()
  })

  it('refuses a sync output once a pipe returned a promise', () => {
    const p = tp('p').pipe(() => Promise.resolve(1), null, 'n')
    // @ts-expect-error sync end is unavailable once a pipe is async
    p.end('n')
    expectTypeOf(p.end()).returns.toEqualTypeOf<undefined>()
  })

  it('refuses unknown output names', () => {
    // @ts-expect-error nope was never produced
    tp('p').endAsync('nope')
  })

  it('reads a dependency as the final output', () => {
    expectTypeOf(tp('p').end('isBlocked')).returns.toEqualTypeOf<boolean>()
  })
})

describe('error handler', () => {
  it('receives the active error by default', () => {
    tp('p').error((error) => expectTypeOf(error).toEqualTypeOf<unknown>())
  })

  it('checks a handler named by dependency for callability and parameter fit', () => {
    const withHandlers = typed({
      config: { retries: 3 },
      logError: (error: unknown): void => {
        void error
      },
      logCount: (count: number): void => {
        void count
      },
    })
    expectTypeOf(withHandlers('p').error('config')).toExtend<Problem>()
    expectTypeOf(withHandlers('p').error('logCount')).toExtend<Problem>()
    expectTypeOf(withHandlers('p').error('logError').end()).returns.toEqualTypeOf<undefined>()
    // @ts-expect-error nope is not a dependency
    withHandlers('p').error('nope')
  })

  it('receives context values as possibly undefined', () => {
    tp('p')
      .pipe(() => 1, null, 'n')
      .error(
        (error, n) => {
          expectTypeOf(error).toEqualTypeOf<unknown>()
          expectTypeOf(n).toEqualTypeOf<number | undefined>()
        },
        ['error', 'n'],
      )
  })
})

describe('untyped factory overloads', () => {
  it('returns the builder without a cast when no defs are given', () => {
    const sp = superpipe()
    expectTypeOf(sp('p')).toEqualTypeOf<PipelineAPI>()
    expectTypeOf(sp('p', [])).toEqualTypeOf<(...args: unknown[]) => void>()
  })
})

describe('HyperNeo-shaped intake pipeline', () => {
  interface IntakeInput {
    text: string
  }
  interface Caller {
    id: string
  }
  interface Db {
    query(sql: string): Promise<unknown>
  }
  interface Target {
    route: string
  }
  type Rejected = { reason: 'blocked' | 'unknown' }

  const admit = (input: IntakeInput, caller: Caller): Result<Target, Rejected> =>
    input.text && caller.id ? { value: { route: 'inbox' } } : { reason: { reason: 'blocked' } }

  it('infers the runner signature and the gate union without a cast', () => {
    const runIntake = typed({})<[IntakeInput, Caller, Db]>('neo-message-intake')
      .input(['input', 'caller', 'db'])
      .pipe(admit, ['input', 'caller'], 'result:receipt')
      .pipe(
        async (input, admitted, db) => {
          expectTypeOf(input).toEqualTypeOf<IntakeInput>()
          expectTypeOf(admitted).toEqualTypeOf<Target>()
          await db.query(admitted.route)
          return { routed: true }
        },
        ['input', 'receipt', 'db'],
        'route',
      )
      .reason((reason) => expectTypeOf(reason).toEqualTypeOf<Rejected>())
      .endAsync('receipt')
    expectTypeOf(runIntake).toEqualTypeOf<{
      (input: IntakeInput, caller: Caller, db: Db): Promise<Target | Rejected>
      withSignal(
        signal: import('../src').AbortSignalLike,
        input: IntakeInput,
        caller: Caller,
        db: Db,
      ): Promise<Target | Rejected>
    }>()
  })
})

describe('builder ordering', () => {
  it('refuses an input pipe after the first pipe', () => {
    const started = tp('p').pipe(() => 1, null, 'n')
    // @ts-expect-error input must come first
    started.input('late')
  })

  it('refuses pipes and a second handler after the error handler', () => {
    const handled = tp('p')
      .pipe(() => 1, null, 'n')
      .error(() => undefined)
    // @ts-expect-error no pipes after the error handler
    handled.pipe(() => 2, null, 'm')
    // @ts-expect-error only one error handler
    handled.error(() => undefined)
    expectTypeOf(handled.end('n')).returns.toEqualTypeOf<number>()
  })

  it('refuses a second reason handler', () => {
    const observed = tp('p').reason(() => undefined)
    // @ts-expect-error only one reason handler
    observed.reason(() => undefined)
    observed.pipe(() => 1, null, 'n').error(() => undefined)
  })
})
