import { describe, expect, it } from 'vitest'
import superpipe, { OutputKeyError } from '../src'

describe('result output protocol', () => {
  const pipe = superpipe()

  it('continues synchronously with a value', () => {
    const run = pipe('result-value')
      .pipe(() => ({ value: 2 }), null, 'result:count')
      .pipe((count) => count + 1, 'count', 'count')
      .end('count')
    expect(run()).to.equal(3)
  })

  it('halts synchronously with a reason and exposes it as the result name', () => {
    let laterRan = false
    const run = pipe('result-reason')
      .pipe(() => ({ reason: 'not-found' }), null, 'result:outcome')
      .pipe(
        () => {
          laterRan = true
          return 'unexpected'
        },
        null,
        'later',
      )
      .end('outcome')
    expect(run()).to.equal('not-found')
    expect(laterRan).to.equal(false)
  })

  it('continues asynchronously with a value', async () => {
    const run = pipe('async-result-value')
      .pipe(() => Promise.resolve({ value: 'ready' }), null, 'result:status')
      .pipe((status) => `${status}!`, 'status', 'out')
      .endAsync('out')
    await expect(run()).resolves.to.equal('ready!')
  })

  it('halts asynchronous next continuations and keeps the first reason', async () => {
    let laterRan = false
    const run = pipe('async-result-reason')
      .pipe(
        (next) => {
          next(null, { reason: 'first' })
          setTimeout(() => next(null, { reason: 'late' }), 0)
        },
        'next',
        'result:outcome',
      )
      .pipe(
        () => {
          laterRan = true
          return 'unexpected'
        },
        null,
        'later',
      )
      .endAsync('outcome')
    await expect(run()).resolves.to.equal('first')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(laterRan).to.equal(false)
  })

  it('keeps concurrent result runs isolated', async () => {
    const run = pipe('concurrent-results')
      .input('value')
      .pipe((value) => Promise.resolve(value), 'value', 'result:outcome')
      .endAsync('outcome')

    await expect(
      Promise.all([run({ value: 'value' }), run({ reason: 'reason' })]),
    ).resolves.toEqual(['value', 'reason'])
  })

  it('rejects malformed or ambiguous result objects at the producing pipe', async () => {
    const malformed = pipe('malformed-result')
      .pipe(() => ({ value: 1, reason: 'no' }), null, 'result:out')
      .endAsync('out')
    const missing = pipe('missing-result')
      .pipe(() => ({ other: 1 }), null, 'result:out')
      .end()
    await expect(malformed()).rejects.toBeInstanceOf(OutputKeyError)
    expect(() => missing()).to.throw(OutputKeyError)
  })

  it('keeps ordinary error-shaped data out of the error channel', () => {
    let handled = false
    const run = pipe('ordinary-error-data')
      .pipe(() => ({ error: 'business data' }), null, 'payload')
      .pipe((payload) => payload.error, 'payload', 'out')
      .error(() => {
        handled = true
      })
      .end('out')
    expect(run()).to.equal('business data')
    expect(handled).to.equal(false)
  })

  it('still sends thrown and next errors through the error channel', () => {
    const thrown = new Error('thrown')
    const nextError = new Error('next')
    const errors = []
    const throwing = pipe('result-throw')
      .pipe(
        () => {
          throw thrown
        },
        null,
        'result:out',
      )
      .error((error) => errors.push(error), 'error')
      .end()
    const callback = pipe('result-next-error')
      .pipe((next) => next(nextError), 'next', 'result:out')
      .error((error) => errors.push(error), 'error')
      .end()
    throwing()
    callback()
    expect(errors).to.deep.equal([thrown, nextError])
  })

  it('does not let a malformed partial result replace a next error', () => {
    const original = new Error('original failure')
    let handled
    const run = pipe('result-partial-error')
      .pipe((next) => next(original, { malformed: true }), 'next', 'result:out')
      .error((error) => {
        handled = error
      }, 'error')
      .end()

    expect(() => run()).to.not.throw()
    expect(handled).to.equal(original)
  })

  it('rejects endAsync with the original error when a partial result is malformed', async () => {
    const original = new Error('async original failure')
    const run = pipe('result-async-partial-error')
      .pipe(
        (next) => setTimeout(() => next(original, { malformed: true }), 0),
        'next',
        'result:out',
      )
      .endAsync('out')

    await expect(run()).rejects.toBe(original)
  })
})
