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
})
