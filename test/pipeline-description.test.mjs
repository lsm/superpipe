import { describe, expect, it } from 'vitest'
import superpipe, { typed } from '../src'

describe('runner pipeline description', () => {
  function resolveTarget(input) {
    return { value: input }
  }

  it('describes a sync pipeline with its declared specs in order', () => {
    const run = superpipe({ isAllowed: () => true })('todo.remove')
      .input(['input', 'caller'])
      .pipe(resolveTarget, 'input', 'result:outcome')
      .pipe('!isAllowed', ['caller', 'outcome'])
      .pipe('?audit', '{outcome, caller}', ['id', 'at'])
      .pipe((outcome) => outcome, 'outcome', 'outcome:final')
      .end('final')

    expect(run.pipeline).to.deep.equal({
      name: 'todo.remove',
      async: false,
      inputs: [['input', 'caller']],
      steps: [
        {
          name: 'resolveTarget',
          injected: false,
          not: false,
          optional: false,
          input: 'input',
          output: 'result:outcome',
        },
        {
          name: 'isAllowed',
          injected: true,
          not: true,
          optional: false,
          input: ['caller', 'outcome'],
        },
        {
          name: 'audit',
          injected: true,
          not: false,
          optional: true,
          input: '{outcome, caller}',
          output: ['id', 'at'],
        },
        {
          name: 'anonymous',
          injected: false,
          not: false,
          optional: false,
          input: 'outcome',
          output: 'outcome:final',
        },
      ],
      output: 'final',
    })
  })

  it('marks an async runner and leaves out specs that were not declared', async () => {
    const run = superpipe()('quiet')
      .pipe(function touch() {}, null)
      .endAsync()

    expect(run.pipeline).to.deep.equal({
      name: 'quiet',
      async: true,
      inputs: [],
      steps: [{ name: 'touch', injected: false, not: false, optional: false }],
    })
    expect(await run()).to.equal(undefined)
  })

  it('describes the declarative and typed entry points the same way', () => {
    const double = (x) => x * 2
    const declarative = superpipe()('double', [
      ['input', ['x']],
      [double, 'x', 'doubled'],
      ['end', 'doubled'],
    ])
    const fluent = typed()('double').input(['x']).pipe(double, ['x'], 'doubled').end('doubled')

    expect(declarative.pipeline).to.deep.equal({
      name: 'double',
      async: false,
      inputs: [['x']],
      steps: [
        {
          name: 'double',
          injected: false,
          not: false,
          optional: false,
          input: 'x',
          output: 'doubled',
        },
      ],
      output: 'doubled',
    })
    expect(fluent.pipeline.steps[0].input).to.deep.equal(['x'])
    expect(fluent.pipeline.name).to.equal(declarative.pipeline.name)
    expect(declarative(4)).to.equal(8)
  })

  it('is frozen and detached from the builder and the declared arrays', () => {
    const names = ['a', 'b']
    const builder = superpipe()('frozen')
      .input(names)
      .pipe((a, b) => a + b, names, 'sum')
    const run = builder.end('sum')
    names.push('c')
    builder.pipe((sum) => sum, 'sum', 'later')

    expect(run.pipeline.inputs).to.deep.equal([['a', 'b']])
    expect(run.pipeline.steps).to.have.lengthOf(1)
    expect(run.pipeline.steps[0].input).to.deep.equal(['a', 'b'])
    expect(Object.isFrozen(run.pipeline)).to.equal(true)
    expect(Object.isFrozen(run.pipeline.steps)).to.equal(true)
    expect(Object.isFrozen(run.pipeline.steps[0])).to.equal(true)
    expect(Object.isFrozen(run.pipeline.steps[0].input)).to.equal(true)
    expect(() => {
      run.pipeline = null
    }).to.throw(TypeError)
    expect(run(1, 2)).to.equal(3)
  })

  it('describes the specs the runner binds when arrays change before it is built', async () => {
    for (const finish of ['end', 'endAsync']) {
      const inputs = ['a']
      const stepInput = ['a']
      const stepOutput = ['x']
      const builder = superpipe()('late')
        .input(inputs)
        .pipe((v) => [v], stepInput, stepOutput)
      inputs[0] = 'b'
      stepInput[0] = 'b'
      stepOutput[0] = 'y'
      const run = builder[finish]('y')

      expect(run.pipeline.inputs).to.deep.equal([['b']])
      expect(run.pipeline.steps[0].input).to.deep.equal(['b'])
      expect(run.pipeline.steps[0].output).to.deep.equal(['y'])
      expect(await run(5)).to.equal(5)
    }
  })

  it('lists the steps of a used part in place with its name', () => {
    function resolveOwner(caller) {
      return { value: caller }
    }
    function createGoal(outcome) {
      return outcome
    }
    const sp = superpipe({ isArchived: () => false })
    const owned = sp
      .steps('goal.owned')
      .pipe(resolveOwner, ['caller', 'input'], 'result:outcome')
      .pipe('!isArchived', 'outcome')
    const create = sp('goal.create')
      .input(['input', 'caller'])
      .use(owned)
      .pipe(createGoal, ['outcome', 'input'], 'outcome')
      .endAsync('outcome')

    expect(create.pipeline.steps).to.deep.equal([
      {
        name: 'resolveOwner',
        injected: false,
        not: false,
        optional: false,
        input: ['caller', 'input'],
        output: 'result:outcome',
        part: 'goal.owned',
      },
      {
        name: 'isArchived',
        injected: true,
        not: true,
        optional: false,
        input: 'outcome',
        part: 'goal.owned',
      },
      {
        name: 'createGoal',
        injected: false,
        not: false,
        optional: false,
        input: ['outcome', 'input'],
        output: 'outcome',
      },
    ])
  })

  it('names the same step the exit channel reports', () => {
    const seen = []
    function deny() {
      return { reason: 'no' }
    }
    const run = superpipe()('same-name')
      .pipe(() => ({ value: 1 }), null, 'result:outcome')
      .pipe(deny, null, 'result:outcome')
      .onExit((exit) => seen.push(exit))
      .end('outcome')
    run()

    expect(run.pipeline.steps[seen[0].step].name).to.equal(seen[0].name)
    expect(seen[0].name).to.equal('deny')
  })
})
