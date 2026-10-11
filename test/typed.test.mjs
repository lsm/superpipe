import { describe, expect, it } from 'vitest'
import superpipe, { typed } from '../src'

describe('typed()', () => {
  it('builds the same runtime pipeline as superpipe()', async () => {
    const deps = { double: (n) => n * 2 }
    const run = typed(deps)('typed-runtime')
      .input(['n'])
      .pipe('double', 'n', 'doubled')
      .pipe((doubled) => doubled + 1, 'doubled', 'out')
      .endAsync('out')

    expect(await run(20)).to.equal(41)
  })

  it('returns a reason from the gate name and leaves later outputs absent', async () => {
    const run = typed()('typed-gate')
      .input('id')
      .pipe((id) => (id ? { value: { id } } : { reason: 'missing' }), 'id', 'result:user')
      .pipe((user) => `hello ${user.id}`, 'user', 'greeting')
      .endAsync(['user', 'greeting'])

    expect(await run('u1')).to.deep.equal([{ id: 'u1' }, 'hello u1'])
    expect(await run('')).to.deep.equal(['missing', undefined])
  })

  it('shares the builder class with the untyped factory', () => {
    const untyped = superpipe()('a')
    const withTypes = typed()('b')
    expect(Object.getPrototypeOf(withTypes)).to.equal(Object.getPrototypeOf(untyped))
  })
})
