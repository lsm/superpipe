/* globals describe, it */

/**
 * Flow-control contract tests.
 *
 * These pin three README-documented behaviors and use only the public API,
 * so the file runs unchanged on any branch:
 *
 *   1. Boolean flow control — a pipe that returns `false` stops the pipeline.
 *   2. `!` not-pipes — prefixing an injected name with `!` inverts its boolean
 *      result (observed via flow control: `!isBlocked` continues only when
 *      isBlocked is falsey, halts when truthy).
 *   3. `?` optional-pipes — prefixing an injected name with `?` skips the pipe
 *      when the dependency (or its input) is undefined, instead of throwing.
 *
 * `master` is the reference implementation and passes all of these.
 * `pre-1.0-refactoring` is expected to FAIL the three "discriminator" cases
 * (1, 2a, 3) — those are the gaps a revival must close. Cases "sanity" and 2b
 * pass on both and serve as controls.
 */
import { expect } from 'chai'
import superpipe from '../src'

describe('Flow-control contract (README-pinned behaviors)', function () {
  // --- control: MUST pass on every branch, else the harness is broken ---
  // Uses two positional args (both branches wrap multiple args into an array
  // identically) so input mapping is unambiguous.
  it('runs a basic pipeline to completion', function (done) {
    const sp = superpipe({})
    const run = sp('sanity')
      .input(['greeting', 'name'])
      .pipe((greeting, name) => `${greeting}, ${name}!`, ['greeting', 'name'], 'message')
      .pipe((message) => {
        expect(message).to.equal('Hello, World!')
        done()
      }, 'message')
      .end()

    run('Hello', 'World')
  })

  // --- 1. false-return stops the pipeline (DISCRIMINATOR) ---
  describe('boolean flow control — return false stops the pipeline', function () {
    it('halts when a pipe returns false; no subsequent pipe runs', function () {
      let afterRan = false
      const sp = superpipe({})
      const run = sp('false-stop')
        .pipe(() => false)              // returns false, does not request next → must halt
        .pipe(() => { afterRan = true }) // sentinel — must NOT run
        .end()

      run()
      expect(afterRan).to.equal(false)
    })
  })

  // --- 2. `!` not-pipe inverts the boolean ---
  describe('! not-pipes — invert the boolean result', function () {
    // 2a — DISCRIMINATOR
    it('halts when the !-inverted dependency is true', function () {
      let afterRan = false
      const sp = superpipe({ isBlocked: () => true })
      const run = sp('not-true')
        .input(['user'])
        .pipe('!isBlocked', 'user')      // !true === false → must halt
        .pipe(() => { afterRan = true }) // sentinel — must NOT run
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(false)
    })

    // 2b — control (passes on both)
    it('continues when the !-inverted dependency is false', function () {
      let afterRan = false
      const sp = superpipe({ isBlocked: () => false })
      const run = sp('not-false')
        .input(['user'])
        .pipe('!isBlocked', 'user')      // !false === true → must continue
        .pipe(() => { afterRan = true }) // sentinel — must run
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(true)
    })
  })

  // --- 3. `?` prefix marks a pipe optional (DISCRIMINATOR) ---
  describe('? optional-pipes — prefix marks a pipe optional', function () {
    it('skips a ?-prefixed pipe when the dependency is undefined', function () {
      let afterRan = false
      const sp = superpipe({})           // no `maybeHandler` dependency provided
      const run = sp('optional-prefix')
        .input(['user'])
        .pipe('?maybeHandler', 'maybeValue') // dep + input both undefined → must skip
        .pipe(() => { afterRan = true })     // sentinel — MUST run
        .end()

      expect(() => run({ user: 'x' })).to.not.throw()
      expect(afterRan).to.equal(true)
    })
  })

  // --- 4. single positional scalar arg maps to its input name (DISCRIMINATOR) ---
  describe('positional input — single scalar arg maps to its input name', function () {
    it('assigns the whole arg, not arg[0], to a single input name', function (done) {
      const sp = superpipe({ greet: (name) => `Hello, ${name}!` })
      const run = sp('scalar-arg')
        .input(['name'])
        .pipe('greet', 'name', 'message')
        .pipe((message) => {
          expect(message).to.equal('Hello, World!')
          done()
        }, 'message')
        .end()

      run('World')
    })
  })

  // --- 5. raw boolean dependency (flow control) ---
  describe('raw boolean dependency — used as flow control', function () {
    it('continues when a raw boolean dependency is true', function () {
      let afterRan = false
      const sp = superpipe({ isBlocked: true }) // raw boolean, not a function
      const run = sp('bool-true')
        .input(['user'])
        .pipe('isBlocked', 'user') // true → must continue
        .pipe(() => { afterRan = true })
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(true)
    })

    it('halts when a raw boolean dependency is false', function () {
      let afterRan = false
      const sp = superpipe({ isBlocked: false })
      const run = sp('bool-false')
        .input(['user'])
        .pipe('isBlocked', 'user') // false → must halt
        .pipe(() => { afterRan = true }) // sentinel — must NOT run
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(false)
    })

    it('inverts a raw boolean dependency with ! (halts when true)', function () {
      let afterRan = false
      const sp = superpipe({ isBlocked: true })
      const run = sp('bool-not')
        .input(['user'])
        .pipe('!isBlocked', 'user') // !true === false → must halt
        .pipe(() => { afterRan = true }) // sentinel — must NOT run
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(false)
    })
  })
})

// --- review round 2: parity behaviors pinned from the codex findings ---
describe('review-fix contract (parity behaviors)', function () {
  it('resolves pipe inputs from configured dependencies', function () {
    let observed
    const sp = superpipe({ arg1: 'value', fn: (a) => a })
    const run = sp('deps-as-inputs')
      .pipe('fn', 'arg1', 'out')
      .pipe((out) => { observed = out }, 'out')
      .end()

    run()
    expect(observed).to.equal('value')
  })

  it('passes the invocation arguments to pipes that declare no inputs', function (done) {
    const sp = superpipe({})
    const run = sp('args-passthrough')
      .pipe((a, b) => {
        expect(a).to.equal(1)
        expect(b).to.equal(2)
        done()
      })
      .end()

    run(1, 2)
  })

  it('skips an optional pipe when a requested input is undefined', function () {
    let afterRan = false
    const sp = superpipe({ handler: () => { throw new Error('should be skipped') } })
    const run = sp('optional-missing-input')
      .input(['user'])
      .pipe('?handler', 'missingValue')
      .pipe(() => { afterRan = true })
      .end()

    expect(() => run({ user: 'x' })).to.not.throw()
    expect(afterRan).to.equal(true)
  })

  it('throws when a stale next from an earlier pipe is invoked again', function () {
    let staleNext
    const sp = superpipe({})
    const run = sp('stale-next')
      .pipe((next) => { staleNext = next; next(null, 'x') }, 'next', 'first')
      .pipe((next) => { next(null, 'y') }, 'next', 'second')
      .end()

    expect(() => run()).to.not.throw()
    expect(() => staleNext()).to.throw('"next" could not be called more than once in a pipe.')
  })

  it('prefers a runtime false over a configured truthy dependency', function () {
    let afterRan = false
    const sp = superpipe({ enabled: () => true })
    const run = sp('runtime-false')
      .input(['enabled'])
      .pipe('enabled')                 // runtime false must halt, not fall back to the dep
      .pipe(() => { afterRan = true })
      .end()

    run(false)
    expect(afterRan).to.equal(false)
  })

  it('maps a plain-object return to array-declared outputs by name', function () {
    let observed
    const sp = superpipe({})
    const run = sp('object-outputs')
      .pipe(() => ({ abc: 1, xyz: 2 }), null, ['abc', 'xyz'])
      .pipe((abc, xyz) => { observed = [abc, xyz] }, ['abc', 'xyz'])
      .end()

    run()
    expect(observed).to.deep.equal([1, 2])
  })

  it('applies source:destination output renaming', function () {
    let observed
    const sp = superpipe({})
    const run = sp('rename')
      .pipe(() => ({ result: 'data' }), null, 'result:userProfile')
      .pipe((profile) => { observed = profile }, 'userProfile')
      .end()

    run()
    expect(observed).to.equal('data')
  })

  it('preserves a single array argument as one named input', function () {
    let observed
    const sp = superpipe({})
    const run = sp('array-arg')
      .input(['items'])
      .pipe((items) => { observed = items }, 'items')
      .end()

    run([1, 2, 3])
    expect(observed).to.deep.equal([1, 2, 3])
  })

  it('returns the picked object itself from .end("{a, b}")', function () {
    const sp = superpipe({})
    const run = sp('end-object')
      .pipe(() => ({ a: 1, b: 2 }), null, '{a, b}')
      .end('{a, b}')

    expect(run()).to.deep.equal({ a: 1, b: 2 })
  })

  it('auto-finalizes declarative definitions without an end tuple', function () {
    let observed
    const sp = superpipe({ double: (x) => x * 2 })
    const run = sp('declarative', [
      ['input', ['x']],
      ['double', 'x', 'y'],
      [(y) => { observed = y }, 'y'],
    ])

    expect(run).to.be.a('function')
    run(4)
    expect(observed).to.equal(8)
  })

  it('rethrows the original exception when no error handler exists', function () {
    const original = new TypeError('boom')
    const sp = superpipe({})
    const run = sp('error-rethrow')
      .pipe(() => { throw original })
      .end()

    try {
      run()
      throw new Error('expected pipeline to throw')
    } catch (err) {
      expect(err).to.equal(original)
    }
  })
})

// --- review round 3: parity behaviors pinned from the second codex round ---
describe('review-fix contract (round 2 parity behaviors)', function () {
  it('resolves error-handler inputs from configured dependencies', function (done) {
    const sp = superpipe({ config: { retries: 3 } })
    const run = sp('error-deps')
      .pipe(() => { throw new Error('boom') })
      .error((error, config) => {
        expect(error.message).to.equal('boom')
        expect(config.retries).to.equal(3)
        done()
      }, ['error', 'config'])
      .end()

    run()
  })

  it('merges a plain-object return into the store when no output is declared', function () {
    let observed
    const sp = superpipe({})
    const run = sp('object-merge')
      .pipe(() => ({ user: 'alice', role: 'admin' }))
      .pipe((user, role) => { observed = [user, role] }, ['user', 'role'])
      .end()

    run()
    expect(observed).to.deep.equal(['alice', 'admin'])
  })

  it('rethrows the original falsy thrown value as an error, not success', function () {
    let afterRan = false
    const sp = superpipe({})
    const run = sp('falsy-throw')
      .pipe(() => { throw null })   // eslint-disable-line no-throw-literal
      .pipe(() => { afterRan = true })
      .end()

    expect(() => run()).to.throw()
    expect(afterRan).to.equal(false)
  })

  it('stores nothing when multiple outputs receive a primitive return value', function (done) {
    // Master maps only arrays (positionally) and objects (by property);
    // a primitive with multiple output names maps to nothing.
    const sp = superpipe({})
    const run = sp('primitive-multi-output')
      .pipe(() => 'ab', null, ['x', 'y'])
      .pipe((x, y) => {
        expect(x).to.equal(undefined)
        expect(y).to.equal(undefined)
        done()
      }, ['x', 'y'])
      .end()

    expect(() => run()).to.not.throw()
  })

  it('rejects empty input declarations at construction', function () {
    const sp = superpipe({})
    expect(() => sp('bad-input').input([])).to.throw('Input pipe requires a non-empty string')
    expect(() => sp('bad-input2').input('')).to.throw('Input pipe requires a non-empty string')
  })
})

// --- review round 4: behaviors pinned from the third codex round ---
describe('review-fix contract (round 3 parity behaviors)', function () {
  it('selects the declared property for a single output over an object return', function () {
    let observed
    const sp = superpipe({})
    const run = sp('object-single-output')
      .pipe(() => ({ arg2: 'value', other: 1 }), null, 'arg2')
      .pipe((arg2) => { observed = arg2 }, 'arg2')
      .end()

    run()
    expect(observed).to.equal('value')
  })

  it('maps arrays positionally even with a single output name', function () {
    let observed
    const sp = superpipe({})
    const run = sp('array-single-output')
      .pipe(() => ['a', 'b'], null, 'first')
      .pipe((first) => { observed = first }, 'first')
      .end()

    run()
    expect(observed).to.equal('a')
  })

  it('supports the reserved .pipe("input", [...]) form', function () {
    let observed
    const sp = superpipe({ greet: (n) => `hi ${n}` })
    const run = sp('reserved-input')
      .pipe('input', ['name'])
      .pipe('greet', 'name', 'msg')
      .pipe((msg) => { observed = msg }, 'msg')
      .end()

    run('bob')
    expect(observed).to.equal('hi bob')
  })

  it('accepts an empty array as a pipe output declaration meaning none', function () {
    const sp = superpipe({})
    const run = sp('empty-output')
      .pipe(() => 'x', null, [])
      .pipe(() => 'done', null, 'done')
      .end('done')

    expect(run()).to.equal('done')
  })

  it('runs a throwing error handler exactly once', function () {
    let calls = 0
    const sp = superpipe({})
    const run = sp('handler-throws')
      .pipe((next) => { next(new Error('first')) }, 'next')
      .error(() => { calls++; throw new Error('handler exploded') })
      .end()

    expect(() => run()).to.throw('handler exploded')
    expect(calls).to.equal(1)
  })
})
