import { describe, expect, it } from 'vitest'
import superpipe from '../src'

describe('pipeline exit channel', () => {
  const pipe = superpipe()

  it('reports a natural completion as an exit via value', () => {
    const seen = []
    const run = pipe('exit-value')
      .pipe(() => 1, null, 'a')
      .pipe((a) => a + 1, 'a', 'b')
      .onExit((exit) => seen.push(exit))
      .end('b')
    expect(run()).to.equal(2)
    expect(seen).to.have.lengthOf(1)
    expect(seen[0].via).to.equal('value')
    expect(seen[0].step).to.equal(null)
    expect(seen[0].error).to.equal(null)
  })

  it('reports a result gate rejection as an exit via reason, naming the stage', () => {
    const seen = []
    const deny = () => ({ reason: 'not-found' })
    const run = pipe('exit-reason')
      .pipe(() => ({ value: 1 }), null, 'result:outcome')
      .pipe(deny, null, 'result:outcome')
      .pipe(() => 'unreachable', null, 'later')
      .onExit((exit) => seen.push(exit))
      .end('outcome')
    expect(run()).to.equal('not-found')
    expect(seen).to.have.lengthOf(1)
    expect(seen[0].via).to.equal('reason')
    expect(seen[0].step).to.equal(1)
    expect(seen[0].name).to.equal('deny')
    expect(seen[0].reason).to.equal('not-found')
  })

  it('distinguishes a boolean halt from a reason rejection', () => {
    const seen = []
    const run = superpipe({ isBlocked: (user) => user.blocked })('exit-halt')
      .input('user')
      .pipe('!isBlocked', 'user')
      .pipe(() => 'unreachable', null, 'later')
      .onExit((exit) => seen.push(exit))
      .end('later')
    run({ blocked: true })
    expect(seen).to.have.lengthOf(1)
    expect(seen[0].via).to.equal('halt')
    expect(seen[0].name).to.equal('isBlocked')
    expect(seen[0].reason).to.equal(undefined)
  })

  it('reports a thrown error as an exit via error and still runs the error handler', () => {
    const seen = []
    const handled = []
    const boom = new Error('boom')
    const run = pipe('exit-error')
      .pipe(
        () => {
          throw boom
        },
        null,
        'a',
      )
      .onExit((exit) => seen.push(exit))
      .error((err) => handled.push(err))
      .end('a')
    run()
    expect(seen).to.have.lengthOf(1)
    expect(seen[0].via).to.equal('error')
    expect(seen[0].error).to.equal(boom)
    expect(handled).to.deep.equal([boom])
  })

  it('runs the exit handler exactly once for an async run', async () => {
    const seen = []
    const run = pipe('exit-async')
      .pipe(async () => ({ reason: 'denied' }), null, 'result:outcome')
      .onExit((exit) => seen.push(exit.via))
      .endAsync('outcome')
    expect(await run()).to.equal('denied')
    expect(seen).to.deep.equal(['reason'])
  })

  it('reports an aborted run as an exit via abort', async () => {
    const controller = new AbortController()
    const seen = []
    const run = pipe('exit-abort')
      .pipe(
        (next) => {
          setTimeout(() => next(null, 'late'), 50)
        },
        'next',
        'a',
      )
      .onExit((exit) => seen.push(exit.via))
      .endAsync('a')
    const pending = run.withSignal(controller.signal)
    controller.abort()
    await expect(pending).rejects.toThrow('Pipeline aborted.')
    expect(seen).to.deep.equal(['abort'])
  })

  it('runs every exit handler in registration order', () => {
    const order = []
    const run = pipe('exit-order')
      .pipe(() => 1, null, 'a')
      .onExit(() => order.push('first'))
      .onExit(() => order.push('second'))
      .end('a')
    run()
    expect(order).to.deep.equal(['first', 'second'])
  })

  it('never lets a throwing exit handler change the run outcome', () => {
    const run = pipe('exit-throws')
      .pipe(() => 7, null, 'a')
      .onExit(() => {
        throw new Error('handler exploded')
      })
      .end('a')
    expect(run()).to.equal(7)
  })

  it('calls the reason handler only on a reason exit', () => {
    const reasons = []
    const build = (name, fn) =>
      pipe(name)
        .pipe(fn, null, 'result:outcome')
        .reason((reason, exit) => reasons.push([reason, exit.via]))
        .end('outcome')
    build('reason-hit', () => ({ reason: 'denied' }))()
    build('reason-miss', () => ({ value: 'ok' }))()
    expect(reasons).to.deep.equal([['denied', 'reason']])
  })

  it('refuses a second reason handler', () => {
    const builder = pipe('reason-twice').reason(() => {})
    expect(() => builder.reason(() => {})).to.throw('one reason handler')
  })

  it('names the stage that threw on an error exit', () => {
    const seen = []
    const explode = () => {
      throw new Error('boom')
    }
    const run = pipe('exit-error-stage')
      .pipe(() => 1, null, 'a')
      .pipe(explode, 'a', 'b')
      .onExit((exit) => seen.push(exit))
      .error(() => {})
      .end('b')
    run()
    expect(seen[0].via).to.equal('error')
    expect(seen[0].step).to.equal(1)
    expect(seen[0].name).to.equal('explode')
  })

  it('names the stage whose promise rejected on an async error exit', async () => {
    const seen = []
    const failAsync = async () => {
      throw new Error('async boom')
    }
    const run = pipe('exit-error-async-stage')
      .pipe(() => 1, null, 'a')
      .pipe(failAsync, 'a', 'b')
      .onExit((exit) => seen.push(exit))
      .endAsync('b')
    await expect(run()).rejects.toThrow('async boom')
    expect(seen[0].via).to.equal('error')
    expect(seen[0].step).to.equal(1)
    expect(seen[0].name).to.equal('failAsync')
  })

  it('dispatches exit handlers when a synchronous run throws out of the executor', () => {
    const seen = []
    const run = pipe('exit-sync-throw')
      .pipe(() => ({ notTheResultShape: true }), null, 'result:outcome')
      .onExit((exit) => seen.push(exit))
      .end('outcome')
    expect(() => run()).to.throw()
    expect(seen).to.have.lengthOf(1)
    expect(seen[0].via).to.equal('error')
    expect(seen[0].error).to.be.instanceOf(Error)
  })

  it('dispatches an abort exit when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const seen = []
    let ranAStage = false
    const run = pipe('exit-pre-aborted')
      .pipe(
        () => {
          ranAStage = true
          return 1
        },
        null,
        'a',
      )
      .onExit((exit) => seen.push(exit))
      .endAsync('a')
    await expect(run.withSignal(controller.signal)).rejects.toThrow('Pipeline aborted.')
    expect(seen).to.have.lengthOf(1)
    expect(seen[0].via).to.equal('abort')
    expect(ranAStage).to.equal(false)
  })

  it('names the stage whose destructuring output went unfulfilled', async () => {
    const seen = []
    const missing = async () => undefined
    const run = pipe('exit-expect-value')
      .pipe(() => 1, null, 'seed')
      .pipe(missing, 'seed', ['x', 'y'])
      .onExit((exit) => seen.push(exit))
      .endAsync('x')
    await expect(run()).rejects.toThrow()
    expect(seen[0].via).to.equal('error')
    expect(seen[0].step).to.equal(1)
    expect(seen[0].name).to.equal('missing')
  })

  it('preserves a non-Error rejection verbatim on the exit record', async () => {
    const seen = []
    const run = pipe('exit-non-error')
      .pipe(
        async () => {
          throw 'denied'
        },
        null,
        'a',
      )
      .onExit((exit) => seen.push(exit))
      .endAsync('a')
    await expect(run()).rejects.toBe('denied')
    expect(seen[0].via).to.equal('error')
    expect(seen[0].error).to.equal('denied')
  })

  it('names the stage whose async output had the wrong shape', async () => {
    const seen = []
    const malformed = async () => 'not-an-object'
    const run = pipe('exit-shape')
      .pipe(() => 1, null, 'seed')
      .pipe(malformed, 'seed', 'result:outcome')
      .onExit((exit) => seen.push(exit))
      .endAsync('outcome')
    await expect(run()).rejects.toThrow()
    expect(seen[0].via).to.equal('error')
    expect(seen[0].step).to.equal(1)
    expect(seen[0].name).to.equal('malformed')
  })

  it('contains a rejected promise returned by an exit handler', async () => {
    const unhandled = []
    const onUnhandled = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      const run = pipe('exit-async-handler')
        .pipe(() => 5, null, 'a')
        .onExit(async () => {
          throw new Error('handler exploded')
        })
        .endAsync('a')
      expect(await run()).to.equal(5)
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(unhandled).to.have.lengthOf(0)
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('refuses a non-function exit handler', () => {
    expect(() => pipe('exit-bad').onExit('nope')).to.throw('must be a function')
  })
})
