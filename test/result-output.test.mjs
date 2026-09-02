import { describe, expect, it } from 'vitest'
import superpipe, { OutputKeyError, PipelineAbortedError } from '../src'

describe('result: output protocol', () => {
  it('binds a value arm and continues like an ordinary named output', () => {
    let observed
    const run = superpipe()('result-value')
      .pipe(() => ({ value: 3 }), null, 'result:count')
      .pipe(
        (count) => {
          observed = count
          return { value: count * 2 }
        },
        'count',
        'result:total',
      )
      .end('total')

    expect(run()).to.equal(6)
    expect(observed).to.equal(3)
  })

  it('returns a reason immediately from sync endings and does not run later stages', () => {
    let afterRan = false
    const run = superpipe()('result-reason-sync')
      .pipe(() => ({ reason: { kind: 'rejected' } }), null, 'result:address')
      .pipe(() => {
        afterRan = true
      })
      .end('outcome')

    expect(run()).to.deep.equal({ kind: 'rejected' })
    expect(afterRan).to.equal(false)
  })

  it('returns a reason from an output-less sync ending', () => {
    const run = superpipe()('result-reason-sync-no-output')
      .pipe(() => ({ reason: undefined }), null, 'result:value')
      .end()

    expect(run()).to.equal(undefined)
  })

  it('works through promise and next continuations', async () => {
    const fromPromise = superpipe()('result-promise')
      .pipe(() => Promise.resolve({ value: 'ready' }), null, 'result:state')
      .pipe((state) => Promise.resolve({ reason: `stopped:${state}` }), 'state', 'result:outcome')
      .endAsync('ignored')
    const fromNext = superpipe()('result-next')
      .pipe((next) => setTimeout(() => next(null, { reason: 'nope' }), 1), 'next', 'result:value')
      .endAsync('outcome')

    await expect(fromPromise()).resolves.to.equal('stopped:ready')
    await expect(fromNext()).resolves.to.equal('nope')
  })

  it('keeps failures on the error channel and preserves error partial data', async () => {
    const failure = new Error('network')
    let handlerInput
    const run = superpipe()('result-error')
      .pipe((next) => next(failure, { partial: true }), 'next', 'result:reply')
      .error(
        (error, reply) => {
          handlerInput = [error, reply]
        },
        ['error', 'reply'],
      )
      .endAsync('reply')

    await expect(run()).rejects.to.equal(failure)
    expect(handlerInput).to.deep.equal([failure, { partial: true }])
  })

  it('validates malformed and ambiguous result objects at their producing pipe', async () => {
    const malformed = superpipe()('result-malformed')
      .pipe(() => null, null, 'result:value')
      .end()
    const ambiguous = superpipe()('result-ambiguous')
      .pipe(() => ({ value: 1, reason: 'no' }), null, 'result:value')
      .end()
    const missing = superpipe()('result-missing')
      .pipe(() => ({}), null, 'result:value')
      .endAsync('value')

    expect(() => malformed()).to.throw(OutputKeyError)
    expect(() => ambiguous()).to.throw(OutputKeyError)
    await expect(missing()).rejects.toBeInstanceOf(OutputKeyError)
  })

  it('does not reinterpret ordinary outputs, gates, or skipped optional pipes', async () => {
    let ordinary
    const regular = superpipe()('ordinary-output')
      .pipe(() => ({ reason: 'data' }), null, 'record')
      .pipe((record) => {
        ordinary = record
      }, 'record')
      .end()
    const gated = superpipe({ enabled: false })('result-gate')
      .pipe('enabled')
      .pipe(() => ({ value: 'unreachable' }), null, 'result:value')
      .endAsync('value')
    const skipped = superpipe()('result-skip')
      .pipe('?missing', 'input', 'result:value')
      .pipe(() => ({ value: 'continued' }), null, 'result:outcome')
      .end('outcome')

    regular()
    expect(ordinary).to.deep.equal({ reason: 'data' })
    await expect(gated()).resolves.to.equal(undefined)
    expect(skipped()).to.equal('continued')
  })

  it('discards late result callbacks after cancellation', async () => {
    let afterRan = false
    const run = superpipe()('result-cancel')
      .pipe((next) => setTimeout(() => next(null, { reason: 'late' }), 15), 'next', 'result:value')
      .pipe(() => {
        afterRan = true
      })
      .endAsync('value')
    const controller = new AbortController()
    const pending = run.withSignal(controller.signal)
    controller.abort('stop')

    await expect(pending).rejects.toBeInstanceOf(PipelineAbortedError)
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(afterRan).to.equal(false)
  })

  it('ignores a retained late callback after a reason settles the run', async () => {
    let afterRan = false
    const run = superpipe()('result-late-next')
      .pipe(
        (next) => {
          next(null, { reason: 'first reason wins' })
          setTimeout(() => next(null, { value: 'late value' }), 1)
        },
        'next',
        'result:value',
      )
      .pipe(() => {
        afterRan = true
      })
      .endAsync('value')

    await expect(run()).resolves.to.equal('first reason wins')
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(afterRan).to.equal(false)
  })
})
