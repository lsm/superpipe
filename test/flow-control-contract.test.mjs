import { describe, expect, it } from 'vitest'
import superpipe, { PipelineAbortedError } from '../src'

describe('Flow-control contract (README-pinned behaviors)', () => {
  it('runs a basic pipeline to completion', () =>
    new Promise((done) => {
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
    }))

  describe('boolean returns — a function pipe returning false is data', () => {
    it('stores a returned false under the output name and continues', () => {
      let observed = 'unset'
      const sp = superpipe({})
      const run = sp('false-data')
        .pipe(() => false, null, 'flag')
        .pipe((flag) => {
          observed = flag
        }, 'flag')
        .end()

      run()
      expect(observed).to.equal(false)
    })

    it('treats an injected function dependency boolean return as data', () => {
      let observed = 'unset'
      const sp = superpipe({ check: () => false })
      const run = sp('injected-bool-data')
        .input(['user'])
        .pipe('check', 'user', 'ok')
        .pipe((ok) => {
          observed = ok
        }, 'ok')
        .end()

      run('x')
      expect(observed).to.equal(false)
    })

    it('halts only on the declarative channels: boolean deps and !-pipes', () => {
      let afterRan = false
      const sp = superpipe({ isBlocked: false })
      const run = sp('bool-dep-halt')
        .input(['user'])
        .pipe('isBlocked', 'user')
        .pipe(() => {
          afterRan = true
        })
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(false)
    })
  })

  describe('! not-pipes — invert the boolean result', () => {
    it('halts when the !-inverted dependency is true', () => {
      let afterRan = false
      const sp = superpipe({ isBlocked: () => true })
      const run = sp('not-true')
        .input(['user'])
        .pipe('!isBlocked', 'user')
        .pipe(() => {
          afterRan = true
        })
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(false)
    })

    it('continues when the !-inverted dependency is false', () => {
      let afterRan = false
      const sp = superpipe({ isBlocked: () => false })
      const run = sp('not-false')
        .input(['user'])
        .pipe('!isBlocked', 'user')
        .pipe(() => {
          afterRan = true
        })
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(true)
    })
  })

  describe('? optional-pipes — prefix marks a pipe optional', () => {
    it('skips a ?-prefixed pipe when the dependency is undefined', () => {
      let afterRan = false
      const sp = superpipe({})
      const run = sp('optional-prefix')
        .input(['user'])
        .pipe('?maybeHandler', 'maybeValue')
        .pipe(() => {
          afterRan = true
        })
        .end()

      expect(() => run({ user: 'x' })).to.not.throw()
      expect(afterRan).to.equal(true)
    })
  })

  describe('positional input — single scalar arg maps to its input name', () => {
    it('assigns the whole arg, not arg[0], to a single input name', () =>
      new Promise((done) => {
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
      }))
  })

  describe('raw boolean dependency — used as flow control', () => {
    it('continues when a raw boolean dependency is true', () => {
      let afterRan = false
      const sp = superpipe({ isBlocked: true })
      const run = sp('bool-true')
        .input(['user'])
        .pipe('isBlocked', 'user')
        .pipe(() => {
          afterRan = true
        })
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(true)
    })

    it('halts when a raw boolean dependency is false', () => {
      let afterRan = false
      const sp = superpipe({ isBlocked: false })
      const run = sp('bool-false')
        .input(['user'])
        .pipe('isBlocked', 'user')
        .pipe(() => {
          afterRan = true
        })
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(false)
    })

    it('inverts a raw boolean dependency with ! (halts when true)', () => {
      let afterRan = false
      const sp = superpipe({ isBlocked: true })
      const run = sp('bool-not')
        .input(['user'])
        .pipe('!isBlocked', 'user')
        .pipe(() => {
          afterRan = true
        })
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(false)
    })
  })
})

describe('review-fix contract (parity behaviors)', () => {
  it('resolves pipe inputs from configured dependencies', () => {
    let observed
    const sp = superpipe({ arg1: 'value', fn: (a) => a })
    const run = sp('deps-as-inputs')
      .pipe('fn', 'arg1', 'out')
      .pipe((out) => {
        observed = out
      }, 'out')
      .end()

    run()
    expect(observed).to.equal('value')
  })

  it('passes the invocation arguments to pipes that declare no inputs', () =>
    new Promise((done) => {
      const sp = superpipe({})
      const run = sp('args-passthrough')
        .pipe((a, b) => {
          expect(a).to.equal(1)
          expect(b).to.equal(2)
          done()
        })
        .end()

      run(1, 2)
    }))

  it('skips an optional pipe when a requested input is undefined', () => {
    let afterRan = false
    const sp = superpipe({
      handler: () => {
        throw new Error('should be skipped')
      },
    })
    const run = sp('optional-missing-input')
      .input(['user'])
      .pipe('?handler', 'missingValue')
      .pipe(() => {
        afterRan = true
      })
      .end()

    expect(() => run({ user: 'x' })).to.not.throw()
    expect(afterRan).to.equal(true)
  })

  it('throws when a stale next from an earlier pipe is invoked again', () => {
    let staleNext
    const sp = superpipe({})
    const run = sp('stale-next')
      .pipe(
        (next) => {
          staleNext = next
          next(null, 'x')
        },
        'next',
        'first',
      )
      .pipe(
        (next) => {
          next(null, 'y')
        },
        'next',
        'second',
      )
      .end()

    expect(() => run()).to.not.throw()
    expect(() => staleNext()).to.throw('"next" could not be called more than once in a pipe.')
  })

  it('prefers a runtime false over a configured truthy dependency', () => {
    let afterRan = false
    const sp = superpipe({ enabled: () => true })
    const run = sp('runtime-false')
      .input(['enabled'])
      .pipe('enabled')
      .pipe(() => {
        afterRan = true
      })
      .end()

    run(false)
    expect(afterRan).to.equal(false)
  })

  it('maps a plain-object return to array-declared outputs by name', () => {
    let observed
    const sp = superpipe({})
    const run = sp('object-outputs')
      .pipe(() => ({ abc: 1, xyz: 2 }), null, ['abc', 'xyz'])
      .pipe(
        (abc, xyz) => {
          observed = [abc, xyz]
        },
        ['abc', 'xyz'],
      )
      .end()

    run()
    expect(observed).to.deep.equal([1, 2])
  })

  it('applies source:destination output renaming', () => {
    let observed
    const sp = superpipe({})
    const run = sp('rename')
      .pipe(() => ({ result: 'data' }), null, 'result:userProfile')
      .pipe((profile) => {
        observed = profile
      }, 'userProfile')
      .end()

    run()
    expect(observed).to.equal('data')
  })

  it('preserves a single array argument as one named input', () => {
    let observed
    const sp = superpipe({})
    const run = sp('array-arg')
      .input(['items'])
      .pipe((items) => {
        observed = items
      }, 'items')
      .end()

    run([1, 2, 3])
    expect(observed).to.deep.equal([1, 2, 3])
  })

  it('returns the picked object itself from .end("{a, b}")', () => {
    const sp = superpipe({})
    const run = sp('end-object')
      .pipe(() => ({ a: 1, b: 2 }), null, '{a, b}')
      .end('{a, b}')

    expect(run()).to.deep.equal({ a: 1, b: 2 })
  })

  it('auto-finalizes declarative definitions without an end tuple', () => {
    let observed
    const sp = superpipe({ double: (x) => x * 2 })
    const run = sp('declarative', [
      ['input', ['x']],
      ['double', 'x', 'y'],
      [
        (y) => {
          observed = y
        },
        'y',
      ],
    ])

    expect(run).to.be.a('function')
    run(4)
    expect(observed).to.equal(8)
  })

  it('rethrows the original exception when no error handler exists', () => {
    const original = new TypeError('boom')
    const sp = superpipe({})
    const run = sp('error-rethrow')
      .pipe(() => {
        throw original
      })
      .end()

    try {
      run()
      throw new Error('expected pipeline to throw')
    } catch (err) {
      expect(err).to.equal(original)
    }
  })
})

describe('review-fix contract (round 2 parity behaviors)', () => {
  it('resolves error-handler inputs from configured dependencies', () =>
    new Promise((done) => {
      const sp = superpipe({ config: { retries: 3 } })
      const run = sp('error-deps')
        .pipe(() => {
          throw new Error('boom')
        })
        .error(
          (error, config) => {
            expect(error.message).to.equal('boom')
            expect(config.retries).to.equal(3)
            done()
          },
          ['error', 'config'],
        )
        .end()

      run()
    }))

  it('discards a plain-object return when no output is declared', () => {
    // No output spec means effects only — the return value is not stored,
    // not even a plain object (explicit '{...}' opts back into merging).
    let observed
    const sp = superpipe({})
    const run = sp('object-merge')
      .pipe(() => ({ user: 'alice', role: 'admin' }))
      .pipe(
        (user, role) => {
          observed = [user, role]
        },
        ['user', 'role'],
      )
      .end()

    run()
    expect(observed).to.deep.equal([undefined, undefined])
  })

  it('rethrows the original falsy thrown value as an error, not success', () => {
    let afterRan = false
    const sp = superpipe({})
    const run = sp('falsy-throw')
      .pipe(() => {
        throw null
      })
      .pipe(() => {
        afterRan = true
      })
      .end()

    expect(() => run()).to.throw()
    expect(afterRan).to.equal(false)
  })

  it('throws when multiple output names receive a primitive return value', () => {
    // A list spec with a non-structural return is a spec/return mismatch —
    // the same contract braces follow. (Previously stored nothing
    // silently; master stored the whole value for a single name.)
    const sp = superpipe({})
    const run = sp('primitive-multi-output')
      .pipe(() => 'ab', null, ['x', 'y'])
      .end()

    expect(() => run()).to.throw('destructures, but the pipe returned string')
  })

  it('rejects empty input declarations at construction', () => {
    const sp = superpipe({})
    expect(() => sp('bad-input').input([])).to.throw('Input pipe requires a non-empty string')
    expect(() => sp('bad-input2').input('')).to.throw('Input pipe requires a non-empty string')
  })
})

describe('review-fix contract (round 3 parity behaviors)', () => {
  it('binds a whole object return under a single output name', () => {
    // One name, one value: the declaration no longer means property-pick
    // depending on the runtime type of the return.
    const returned = { arg2: 'value', other: 1 }
    let observed
    const sp = superpipe({})
    const run = sp('object-single-output')
      .pipe(() => returned, null, 'arg2')
      .pipe((arg2) => {
        observed = arg2
      }, 'arg2')
      .end()

    run()
    expect(observed).to.equal(returned)
  })

  it('binds a whole array return under a single output name', () => {
    const returned = ['a', 'b']
    let observed
    const sp = superpipe({})
    const run = sp('array-single-output')
      .pipe(() => returned, null, 'first')
      .pipe((first) => {
        observed = first
      }, 'first')
      .end()

    run()
    expect(observed).to.equal(returned)
  })

  it('supports the reserved .pipe("input", [...]) form', () => {
    let observed
    const sp = superpipe({ greet: (n) => `hi ${n}` })
    const run = sp('reserved-input')
      .pipe('input', ['name'])
      .pipe('greet', 'name', 'msg')
      .pipe((msg) => {
        observed = msg
      }, 'msg')
      .end()

    run('bob')
    expect(observed).to.equal('hi bob')
  })

  it('accepts an empty array as a pipe output declaration meaning none', () => {
    const sp = superpipe({})
    const run = sp('empty-output')
      .pipe(() => 'x', null, [])
      .pipe(() => 'done', null, 'done')
      .end('done')

    expect(run()).to.equal('done')
  })

  it('runs a throwing error handler exactly once', () => {
    let calls = 0
    const sp = superpipe({})
    const run = sp('handler-throws')
      .pipe((next) => {
        next(new Error('first'))
      }, 'next')
      .error(() => {
        calls++
        throw new Error('handler exploded')
      })
      .end()

    expect(() => run()).to.throw('handler exploded')
    expect(calls).to.equal(1)
  })
})

describe('review-fix contract (round 4 parity behaviors)', () => {
  it('processes tuples that follow an explicit end tuple', () =>
    new Promise((done) => {
      const sp = superpipe({ tag: (s) => `tagged:${s}` })
      const run = sp('end-then-more', [
        ['input', ['x']],
        ['end'],
        ['tag', 'x', 'y'],
        [
          (y) => {
            expect(y).to.equal('tagged:hi')
            done()
          },
          'y',
        ],
      ])

      run('hi')
    }))

  it('keeps colon-bearing input names literal', () =>
    new Promise((done) => {
      const sp = superpipe({})
      const run = sp('literal-colon-input')
        .input(['source:destination'])
        .pipe((v) => {
          expect(v).to.equal('raw')
          done()
        }, 'source:destination')
        .end()

      run('raw')
    }))
})

describe('review-fix contract (round 5 parity behaviors)', () => {
  it('sees dependency updates made after the executor was built', () => {
    const deps = { enabled: false }
    const sp = superpipe(deps)
    let afterRan = false
    const run = sp('live-deps')
      .pipe('enabled')
      .pipe(() => {
        afterRan = true
      })
      .end()

    run()
    expect(afterRan).to.equal(false)

    deps.enabled = true
    run()
    expect(afterRan).to.equal(true)
  })

  it('skips an optional pipe whose object-string input has missing values', () => {
    let afterRan = false
    const sp = superpipe({
      handler: () => {
        throw new Error('should be skipped')
      },
    })
    const run = sp('optional-object-input')
      .input(['user'])
      .pipe('?handler', '{user, config}')
      .pipe(() => {
        afterRan = true
      })
      .end()

    expect(() => run({ user: 'x' })).to.not.throw()
    expect(afterRan).to.equal(true)
  })

  it('accumulates multiple input declarations', () =>
    new Promise((done) => {
      const sp = superpipe({})
      const run = sp('multi-input')
        .input(['arg1'])
        .pipe('input', ['arg2'])
        .pipe(
          (arg1, arg2) => {
            expect(arg1).to.equal('a')
            expect(arg2).to.equal('a')
            done()
          },
          ['arg1', 'arg2'],
        )
        .end()

      run('a')
    }))

  it('resolves .end(output) from configured dependencies', () => {
    const sp = superpipe({ config: 42 })
    const run = sp('end-from-deps')
      .pipe(() => 'unused', null, 'ignored')
      .end('config')

    expect(run()).to.equal(42)
  })

  it('rejects an empty-string output declaration at construction', () => {
    const sp = superpipe({})
    expect(() => sp('empty-output').pipe(() => 1, null, '')).to.throw('non-empty string')
  })
})

describe('review-fix contract (round 6 parity behaviors)', () => {
  it('wraps non-Error values passed to next(error)', () => {
    const sp = superpipe({})
    const run = sp('string-error')
      .pipe((next) => {
        next('boom')
      }, 'next')
      .end()

    try {
      run()
      throw new Error('expected pipeline to throw')
    } catch (err) {
      expect(err).to.be.an.instanceof(Error)
      expect(err.message).to.contain('boom')
    }
  })
})

describe('review-fix contract (round 7 parity behaviors)', () => {
  it('maps an absent object-string input argument to undefined values', () =>
    new Promise((done) => {
      const sp = superpipe({})
      const run = sp('missing-obj-arg')
        .input('{a}')
        .pipe(({ a }) => {
          expect(a).to.equal(undefined)
          done()
        }, '{a}')
        .end()

      run()
    }))

  it('throws when object-string outputs pick from a scalar return', () => {
    // Braces select properties; a scalar return cannot be picked from —
    // a spec/return mismatch fails loudly instead of storing undefined.
    const sp = superpipe({})
    const run = sp('objstring-scalar')
      .pipe(() => 'scalar', null, '{a}')
      .end()

    expect(() => run()).to.throw('picks properties')
  })
})

describe('error channel contract (state-based error)', () => {
  it('treats an error property merged from a pipe result as data', () =>
    new Promise((done) => {
      const failure = new Error('from-result')
      const sp = superpipe({})
      const run = sp('error-in-result')
        .pipe(() => ({ error: failure }), null, '{error}')
        .pipe((error) => {
          expect(error).to.equal(failure)
          done()
        }, 'error')
        .end()

      run()
    }))

  it('resolves the error handler `error` input from state, not container data', () => {
    const dataError = new Error('data-named-error')
    const realError = new Error('real-failure')
    const sp = superpipe({})
    const run = sp('error-input-from-state')
      .pipe(() => ({ error: dataError }), null, '{error}')
      .pipe(() => {
        throw realError
      })
      .error((error) => {
        expect(error).to.equal(realError)
      }, 'error')
      .end()

    run()
  })

  it('delivers a result value alongside an error to the handler inputs', () => {
    const failure = new Error('with-result')
    const sp = superpipe({})
    const run = sp('error-with-value')
      .pipe(
        (next) => {
          next(failure, { key1: 'value1' })
        },
        'next',
        '{key1, key2}',
      )
      .error(({ error, key1, key2 }) => {
        expect(error).to.equal(failure)
        expect(key1).to.equal('value1')
        expect(key2).to.equal(undefined)
      }, '{error, key2, key1}')
      .end()

    run()
  })
})

describe('output namespace contract (reserved names and shadowing)', () => {
  it('throws when a declared output writes the reserved name next', () => {
    const sp = superpipe({})
    const run = sp('reserved-output')
      .pipe(() => 'x', null, 'next')
      .end()

    expect(() => run()).to.throw('Output name "next" is reserved')
  })

  it('throws when a spread object return contains next', () => {
    const sp = superpipe({})
    const run = sp('reserved-undeclared')
      .pipe(() => ({ a: 1, next: () => {} }), null, '{...}')
      .end()

    expect(() => run()).to.throw('Output name "next" is reserved')
  })

  it('throws when an output rename maps onto next', () => {
    const sp = superpipe({})
    const run = sp('reserved-rename')
      .pipe(() => ['x'], null, ['a:next'])
      .end()

    expect(() => run()).to.throw('Output name "next" is reserved')
  })

  it('throws when a runtime output shadows a configured dependency', () => {
    const sp = superpipe({ shared: (v) => v })
    const run = sp('shadow-output')
      .pipe(() => 'value', null, 'shared')
      .end()

    expect(() => run()).to.throw('shadows a configured dependency')
  })

  it('allows an invocation input to override a configured dependency', () => {
    let observed
    const sp = superpipe({ data: () => 'configured' })
    const run = sp('override-input')
      .input(['data'])
      .pipe((data) => data, 'data', 'out')
      .pipe((out) => {
        observed = out
      }, 'out')
      .end()

    run('invoked')
    expect(observed).to.equal('invoked')
  })

  it('throws when an invocation input writes the reserved name next', () => {
    const sp = superpipe({})
    const run = sp('reserved-input').input(['next']).end()

    expect(() => run(() => {})).to.throw('Output name "next" is reserved')
  })

  it('allows non-colliding outputs and inputs to merge normally', () => {
    const sp = superpipe({ dep: (v) => v })
    let observed
    const run = sp('clean-merge')
      .input(['arg1'])
      .pipe((arg1) => arg1.toUpperCase(), 'arg1', 'out')
      .pipe((out) => {
        observed = out
      }, 'out')
      .end()

    run('value')
    expect(observed).to.equal('VALUE')
  })
})

describe('output namespace contract (delivery parity)', () => {
  it('surfaces a namespace error raised through a synchronous next, not the error handler', () => {
    const sp = superpipe({ shared: (v) => v })
    let handlerCalled = false
    const run = sp('sync-next-namespace')
      .pipe(
        (next) => {
          next(null, 'value')
        },
        'next',
        'shared',
      )
      .error(() => {
        handlerCalled = true
      })
      .end()

    expect(() => run()).to.throw('shadows a configured dependency')
    expect(handlerCalled).to.equal(false)
  })

  it('detects shadowing of inherited (prototype) configured dependencies', () => {
    const sp = superpipe(Object.create({ shared: (v) => v }))
    const run = sp('proto-shadow')
      .pipe(() => 'value', null, 'shared')
      .end()

    expect(() => run()).to.throw('shadows a configured dependency')
  })

  it('allows standard Object.prototype names as outputs', () => {
    const sp = superpipe({})
    const run = sp('proto-ok')
      .pipe(() => 'value', null, 'toString')
      .end()

    expect(() => run()).to.not.throw()
  })
})

// --- output binding grammar: each spec form means exactly one thing ---
describe('output binding contract (grammar)', () => {
  it('maps a one-name array spec positionally', () => {
    let observed
    const sp = superpipe({})
    const run = sp('array-spec-positional')
      .pipe(() => ['a', 'b'], null, ['first'])
      .pipe((first) => {
        observed = first
      }, 'first')
      .end()

    run()
    expect(observed).to.equal('a')
  })

  it('throws when a one-name array spec receives a primitive return', () => {
    // Review repro: the list form must not fall through to whole-value
    // binding for non-structural returns — `['first']` means positional
    // for arrays and a spec/return mismatch for everything else, exactly
    // like a multi-name list. Whole-binding lives in the single-name form
    // only; validation upgrades the mismatch from silent-nothing to a
    // throw.
    const sp = superpipe({})
    const run = sp('array-spec-primitive')
      .pipe(() => 'scalar', null, ['first'])
      .end()

    expect(() => run()).to.throw("Output spec ['first'] destructures")
  })

  it('binds a whole object delivered through next under a single output name', () =>
    new Promise((done) => {
      const returned = { a: 1 }
      const sp = superpipe({})
      const run = sp('next-whole-object')
        .pipe(
          (next) => {
            setTimeout(() => next(null, returned), 5)
          },
          'next',
          'obj',
        )
        .pipe((obj) => {
          expect(obj).to.equal(returned)
          done()
        }, 'obj')
        .end()

      run()
    }))

  it('throws when braces pick from an array return', () => {
    // Braces select properties and never switch to positional mapping —
    // picking from an array is a spec/return mismatch.
    const sp = superpipe({})
    const run = sp('braces-array')
      .pipe(() => ['a', 'b'], null, '{first}')
      .end()

    expect(() => run()).to.throw('picks properties')
  })

  it('merges every key of an object return with the {...} spec', () => {
    let observed
    const sp = superpipe({})
    const run = sp('spread-all')
      .pipe(() => ({ user: 'alice', role: 'admin' }), null, '{...}')
      .pipe(
        (user, role) => {
          observed = [user, role]
        },
        ['user', 'role'],
      )
      .end()

    run()
    expect(observed).to.deep.equal(['alice', 'admin'])
  })

  it('throws when the {...} spec receives a scalar return', () => {
    const sp = superpipe({})
    const run = sp('spread-scalar')
      .pipe(() => 'scalar', null, '{...}')
      .end()

    expect(() => run()).to.throw('"{...}" requires a plain-object return')
  })

  it('throws when the {...} spec receives an array return', () => {
    const sp = superpipe({})
    const run = sp('spread-array')
      .pipe(() => ['a', 'b'], null, '{...}')
      .end()

    expect(() => run()).to.throw('"{...}" requires a plain-object return')
  })

  it('surfaces a {...} shape violation as a definition error', () => {
    // A spec/return mismatch is a definition error (like OutputNameError),
    // so it surfaces on the invoking stack — it never routes to the error
    // handler, which is reserved for runtime failures.
    let handlerRuns = 0
    const sp = superpipe({})
    const run = sp('spread-shape-surfaces')
      .pipe(() => 'scalar', null, '{...}')
      .error(() => {
        handlerRuns += 1
      }, 'error')
      .end()

    expect(() => run()).to.throw('requires a plain-object return')
    expect(handlerRuns).to.equal(0)
  })

  it('rejects a nullish return from a {...} spec instead of silently skipping', () => {
    // A destructure spec demands a value from a bare return: a forgot-to-
    // return undefined/null fails fast rather than silently producing nothing.
    const sp = superpipe({})
    const run = sp('spread-nullish')
      .pipe(() => undefined, null, '{...}')
      .end()

    expect(() => run()).to.throw('"{...}" requires the pipe to return a value')
  })

  it('surfaces a nullish return from a {...} spec as a definition error', () => {
    let handlerRuns = 0
    const sp = superpipe({})
    const run = sp('spread-nullish-surfaces')
      .pipe(() => null, null, '{...}')
      .error(() => {
        handlerRuns += 1
      }, 'error')
      .end()

    expect(() => run()).to.throw('requires the pipe to return a value')
    expect(handlerRuns).to.equal(0)
  })

  it('preserves a thrown error from a {...} pipe instead of masking it as a shape violation', () => {
    let received
    const sp = superpipe({})
    const run = sp('spread-throw-preserved')
      .pipe(
        () => {
          throw new Error('boom')
        },
        null,
        '{...}',
      )
      .error((error) => {
        received = error
      }, 'error')
      .end()

    run()
    expect(received).to.be.an.instanceof(Error)
    expect(received.message).to.equal('boom')
  })

  it('preserves a rejected promise from a {...} pipe instead of masking it as a shape violation', async () => {
    const sp = superpipe({})
    const run = sp('spread-reject-preserved')
      .pipe(() => Promise.reject(new Error('async boom')), null, '{...}')
      .endAsync()

    await expect(run()).rejects.toThrow('async boom')
  })

  it('skips an optional {...} pipe instead of failing its shape check', () => {
    let afterRan = false
    const sp = superpipe({})
    const run = sp('spread-optional-skip')
      .pipe('?missing', 'arg', '{...}')
      .pipe(() => {
        afterRan = true
      })
      .end()

    expect(() => run()).to.not.throw()
    expect(afterRan).to.equal(true)
  })

  it('rejects near-miss spread spellings at construction', () => {
    // Review repro: '{a, ...}' and '{...rest}' parsed as ordinary names
    // and stored a literal '...' key, silently losing the values the
    // author meant to merge.
    const sp = superpipe({})
    expect(() => sp('mixed-spread').pipe(() => ({ a: 1 }), null, '{ctx, ...}')).to.throw(
      'the "..." marker only works as the entire spec',
    )
    expect(() => sp('rest-spread').pipe(() => ({ a: 1 }), null, '{...rest}')).to.throw(
      'the "..." marker',
    )
    expect(() => sp('list-spread').pipe(() => ['a'], null, ['first', '...'])).to.throw(
      'the "..." marker',
    )
    expect(() => sp('bare-spread').pipe(() => 'x', null, '...')).to.throw('the "..." marker')
    // Review follow-up: the raw-spec check missed the rename destination —
    // 'value:...' starts with the source name, so the picked value was
    // stored under a literal '...' key.
    expect(() => sp('rename-spread').pipe(() => ({ value: 1 }), null, 'value:...')).to.throw(
      'the "..." marker',
    )
  })

  it('stores a returned __proto__ key as inert data, not prototype pollution', () => {
    // Review repro: JSON.parse keeps `__proto__` as an own key, and a
    // plain assignment merges through Object.prototype's setter — the
    // container's prototype would be swapped and later lookups would
    // inherit the attacker's keys.
    const malicious = JSON.parse('{"__proto__": {"polluted": "yes"}, "safe": 1}')
    let safe
    let polluted = 'unset'
    const sp = superpipe({})
    const run = sp('proto-pollution')
      .pipe(() => malicious, null, '{...}')
      .pipe(
        (safeValue, pollutedValue) => {
          safe = safeValue
          polluted = pollutedValue
        },
        ['safe', 'polluted'],
      )
      .end()

    expect(() => run()).to.not.throw()
    expect(safe).to.equal(1)
    // 'polluted' exists only on the object assigned AS the prototype —
    // storing `__proto__` as own data must not expose it.
    expect(polluted).to.equal(undefined)
  })
})

// --- output validation: destructure specs check what they name ---
describe('output validation contract (missing keys)', () => {
  it('throws when a pick names a key the return does not have', () => {
    // The typo case: reolvedTarget vs resolvedTarget fails at the pipe
    // that produced it, not as a silent undefined three pipes later.
    const sp = superpipe({})
    const run = sp('typo-key')
      .pipe(() => ({ resolvedTarget: 'x' }), null, '{reolvedTarget}')
      .end()

    expect(() => run()).to.throw('Output "reolvedTarget" is missing')
  })

  it('throws when a renamed source is missing', () => {
    const sp = superpipe({})
    const run = sp('typo-rename')
      .pipe(() => ({ result: 'x' }), null, 'reolved:userProfile')
      .end()

    expect(() => run()).to.throw('Output "reolved" is missing')
  })

  it('throws when an array spec names a key the object return lacks', () => {
    const sp = superpipe({})
    const run = sp('array-spec-missing')
      .pipe(() => ({ abc: 1 }), null, ['abc', 'xyz'])
      .end()

    expect(() => run()).to.throw('Output "xyz" is missing')
  })

  it('throws when a positional spec exceeds the array return', () => {
    const sp = superpipe({})
    const run = sp('positional-short')
      .pipe(() => ['a'], null, ['first', 'second'])
      .end()

    expect(() => run()).to.throw('maps position 1')
  })

  it('accepts a present-but-undefined value', () => {
    // Presence, not truthiness: an own key holding undefined binds fine.
    let ran = false
    let observed = 'unset'
    const sp = superpipe({})
    const run = sp('present-undefined')
      .pipe(() => ({ a: undefined }), null, '{a}')
      .pipe((a) => {
        ran = true
        observed = a
      }, 'a')
      .end()

    expect(() => run()).to.not.throw()
    expect(ran).to.equal(true)
    expect(observed).to.equal(undefined)
  })

  it('accepts an inherited key', () => {
    // The existence test matches what the pick reads — prototype
    // properties count, so class-shaped returns pick normally.
    let observed
    const sp = superpipe({})
    const run = sp('inherited-key')
      .pipe(() => Object.create({ shared: 'inherited' }), null, '{shared}')
      .pipe((shared) => {
        observed = shared
      }, 'shared')
      .end()

    run()
    expect(observed).to.equal('inherited')
  })

  it('keeps a partial value delivered with an error lenient', () =>
    new Promise((done) => {
      // The error path skips validation: a failing pipe's best-effort
      // result reaches the error handler even with keys missing.
      const failure = new Error('boom')
      const sp = superpipe({})
      const run = sp('error-partial')
        .pipe(
          (next) => {
            next(failure, { key1: 'value1' }) // key2 missing from the partial
          },
          'next',
          '{key1, key2}',
        )
        .error(({ error, key1, key2 }) => {
          expect(error).to.equal(failure)
          expect(key1).to.equal('value1')
          expect(key2).to.equal(undefined)
          done()
        }, '{error, key1, key2}')
        .end()

      run()
    }))

  it('surfaces a missing-key error raised through a synchronous next', () => {
    // A definition error, not a runtime failure: it throws onto the
    // caller's stack and never reaches the error handler.
    let handlerRan = false
    const sp = superpipe({})
    const run = sp('sync-next-missing-key')
      .pipe(
        (next) => {
          next(null, { a: 1 })
        },
        'next',
        '{b}',
      )
      .error(() => {
        handlerRan = true
      })
      .end()

    expect(() => run()).to.throw('Output "b" is missing')
    expect(handlerRan).to.equal(false)
  })

  it('rejects an endAsync run whose async return misses a key', async () => {
    const sp = superpipe({})
    const run = sp('endasync-missing-key')
      .pipe(() => Promise.resolve({ a: 1 }), null, '{a, b}')
      .endAsync('{a}')

    await expect(run()).rejects.toThrow('Output "b" is missing')
  })

  it('never lets a scalar partial value mask the real error', () => {
    // Review repro: the shape checks used to throw on the error path too,
    // so the OutputKeyError escaped before the real failure was stored —
    // the handler never ran and the caller saw the wrong error.
    const failure = new Error('boom')
    let handlerRuns = 0
    const sp = superpipe({})
    const run = sp('error-scalar-partial')
      .pipe(
        (next) => {
          next(failure, 'partial') // a scalar cannot be picked from
        },
        'next',
        '{key1}',
      )
      .error((error) => {
        handlerRuns += 1
        expect(error).to.equal(failure)
      }, 'error')
      .end()

    expect(() => run()).to.not.throw()
    expect(handlerRuns).to.equal(1)
  })

  it('rejects with the real error when a partial value mismatches the spec', async () => {
    const failure = new Error('real failure')
    const sp = superpipe({})
    const run = sp('endasync-error-shape-mismatch')
      .pipe(
        (next) => {
          setTimeout(() => next(failure, 'partial'), 5)
        },
        'next',
        '{key1, key2}',
      )
      .endAsync('out')

    await expect(run()).rejects.toThrow('real failure')
  })

  it('never lets a non-object spread partial mask the real error', () => {
    const failure = new Error('boom')
    let handlerRuns = 0
    const sp = superpipe({})
    const run = sp('error-spread-partial')
      .pipe(
        (next) => {
          next(failure, 'scalar')
        },
        'next',
        '{...}',
      )
      .error((error) => {
        handlerRuns += 1
        expect(error).to.equal(failure)
      }, 'error')
      .end()

    expect(() => run()).to.not.throw()
    expect(handlerRuns).to.equal(1)
  })

  it('never lets a non-structural list partial mask the real error', () => {
    const failure = new Error('boom')
    let handlerRuns = 0
    const sp = superpipe({})
    const run = sp('error-list-partial')
      .pipe(
        (next) => {
          next(failure, 'scalar')
        },
        'next',
        ['key1'],
      )
      .error((error) => {
        handlerRuns += 1
        expect(error).to.equal(failure)
      }, 'error')
      .end()

    expect(() => run()).to.not.throw()
    expect(handlerRuns).to.equal(1)
  })

  it('stores a picked __proto__ key as inert data, not a silent drop', () => {
    // Review repro: the pick passed the presence check, then the plain
    // assignment wrote through Object.prototype's __proto__ setter onto
    // the fresh output object — no own key, nothing merged, no error.
    const malicious = JSON.parse('{"__proto__": 42, "safe": 1}')
    let observed = 'unset'
    const sp = superpipe({})
    const run = sp('pick-proto')
      .pipe(() => malicious, null, '{__proto__}')
      .pipe((proto) => {
        observed = proto
      }, '__proto__')
      .end()

    run()
    expect(observed).to.equal(42)
  })

  it('surfaces a nested run missing-key error as a definition error', () => {
    // Review repro: a mistyped pick inside a nested pipeline run throws
    // within the outer pipe's fn.apply — like OutputNameError it must
    // surface to the caller, not route to the outer error handler.
    const sp = superpipe({})
    const inner = sp('nested-inner')
      .pipe(() => ({ resolvedTarget: 'x' }), null, '{reolvedTarget}')
      .end()
    let handlerRuns = 0
    const run = sp('nested-outer')
      .pipe(() => {
        inner()
      })
      .error(() => {
        handlerRuns += 1
      })
      .end()

    expect(() => run()).to.throw('Output "reolvedTarget" is missing')
    expect(handlerRuns).to.equal(0)
  })

  it('throws when a destructure spec receives no return value', () => {
    // Review repro: the continuation skips merging a nullish value, so
    // the shape guards never saw `undefined`/`null` — the forgot-to-
    // return case passed silently while a scalar return threw.
    const sp = superpipe({})
    const spread = sp('nullish-spread')
      .pipe(() => undefined, null, '{...}')
      .end()
    const pick = sp('nullish-pick')
      .pipe(() => null, null, '{a}')
      .end()
    const list = sp('nullish-list')
      .pipe(() => undefined, null, ['first'])
      .end()

    expect(() => spread()).to.throw('"{...}" requires the pipe to return a value')
    expect(() => pick()).to.throw('"{a}" requires the pipe to return a value')
    expect(() => list()).to.throw("['first'] requires the pipe to return a value")
  })

  it('still allows a single-name pipe to return nothing', () => {
    // The single form binds whatever arrived, nothing included — no
    // value was promised, so none is demanded.
    let ran = false
    let observed = 'unset'
    const sp = superpipe({})
    const run = sp('nullish-single')
      .pipe(() => undefined, null, 'out')
      .pipe((out) => {
        ran = true
        observed = out
      }, 'out')
      .end()

    expect(() => run()).to.not.throw()
    expect(ran).to.equal(true)
    expect(observed).to.equal(undefined)
  })

  it('still allows a next-based pipe to advance without a value', () => {
    // Bare next() is the protocol's explicit nothing-to-merge — the
    // nullish guard applies to returns, not to next deliveries.
    let ran = false
    const sp = superpipe({})
    const run = sp('nullish-next')
      .pipe(
        (next) => {
          next()
        },
        'next',
        '{a}',
      )
      .pipe(() => {
        ran = true
      })
      .end()

    expect(() => run()).to.not.throw()
    expect(ran).to.equal(true)
  })

  it('still allows a skipped optional pipe with a destructure spec', () => {
    // A skipped optional produces nothing by definition — the nullish
    // guard must not fire on its bare advance.
    let ran = false
    const sp = superpipe({})
    const run = sp('nullish-optional')
      .input(['user'])
      .pipe('?missing', ['next', 'missingValue'], '{a}')
      .pipe(() => {
        ran = true
      })
      .end()

    expect(() => run({ user: 'x' })).to.not.throw()
    expect(ran).to.equal(true)
  })

  it('rejects an endAsync run whose promise resolves to nothing', async () => {
    const sp = superpipe({})
    const run = sp('nullish-async')
      .pipe(() => Promise.resolve(undefined), null, '{...}')
      .endAsync('out')

    await expect(run()).rejects.toThrow('"{...}" requires the pipe to return a value')
  })
})

// --- promise continuation contract: thenable returns are next sugar (#41) ---
describe('promise continuation contract', () => {
  it('continues the pipeline with the resolved value', () =>
    new Promise((done) => {
      const sp = superpipe({})
      const run = sp('promise-value')
        .pipe(() => Promise.resolve('async-value'), null, 'out')
        .pipe((out) => {
          expect(out).to.equal('async-value')
          done()
        }, 'out')
        .end()

      run()
    }))

  it('supports async function pipes', () =>
    new Promise((done) => {
      const sp = superpipe({})
      const run = sp('async-fn')
        .pipe(async () => 'from-async', null, 'out')
        .pipe((out) => {
          expect(out).to.equal('from-async')
          done()
        }, 'out')
        .end()

      run()
    }))

  it('routes rejections to the error handler', () =>
    new Promise((done) => {
      const failure = new Error('rejected')
      const sp = superpipe({})
      const run = sp('promise-reject')
        .pipe(() => Promise.reject(failure), null, 'out')
        .error((error) => {
          expect(error).to.equal(failure)
          done()
        }, 'error')
        .end()

      run()
    }))

  it('wraps falsey rejection reasons as errors, not success', () =>
    new Promise((done) => {
      const sp = superpipe({})
      const run = sp('falsey-reject')
        .pipe(() => Promise.reject(undefined), null, 'out')
        .error((error) => {
          expect(error).to.be.an.instanceof(Error)
          done()
        }, 'error')
        .end()

      run()
    }))

  it('throws when a pipe declares next and returns a thenable', () => {
    const sp = superpipe({})
    const run = sp('ambiguous-continuation')
      .pipe((_next) => Promise.resolve('x'), 'next')
      .end()

    expect(() => run()).to.throw('one continuation channel, not both')
  })

  it('treats a promise resolving to false as data (sync/async parity)', () => {
    let observed = 'unset'
    const sp = superpipe({})
    const run = sp('promise-false')
      .pipe(() => Promise.resolve(false), null, 'flag')
      .pipe((flag) => {
        observed = flag
      }, 'flag')
      .end()

    run()
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(observed).to.equal(false)
        resolve()
      }, 20)
    })
  })

  it('keeps fully synchronous pipelines synchronous', () => {
    const sp = superpipe({})
    const run = sp('sync-still')
      .pipe(() => 'v', null, 'out')
      .end('out')

    expect(run()).to.equal('v')
  })
})

describe('promise continuation contract (thenable edge cases)', () => {
  it('inverts a !-pipe whose async dependency resolves true (halts)', () => {
    let afterRan = false
    const sp = superpipe({ isBlocked: async () => true })
    const run = sp('not-async-true')
      .input(['user'])
      .pipe('!isBlocked', 'user')
      .pipe(() => {
        afterRan = true
      })
      .end()

    run({ role: 'admin' })
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(afterRan).to.equal(false)
        resolve()
      }, 20)
    })
  })

  it('inverts a !-pipe whose async dependency resolves false (continues)', () =>
    new Promise((done) => {
      const sp = superpipe({ isBlocked: async () => false })
      const run = sp('not-async-false')
        .input(['user'])
        .pipe('!isBlocked', 'user')
        .pipe(() => {
          done()
        })
        .end()

      run({ role: 'admin' })
    }))

  it('adopts callable thenables (functions with a then method)', () =>
    new Promise((done) => {
      const callableThenable = Object.assign(() => {}, {
        then(resolve) {
          resolve('from-callable')
        },
      })
      const sp = superpipe({})
      const run = sp('callable-thenable')
        .pipe(() => callableThenable, null, 'out')
        .pipe((out) => {
          expect(out).to.equal('from-callable')
          done()
        }, 'out')
        .end()

      run()
    }))

  it('routes a throwing then method to the error handler, not a sync throw', () =>
    new Promise((done) => {
      const throwingThenable = {
        then() {
          throw new Error('then threw')
        },
      }
      const sp = superpipe({})
      const run = sp('throwing-then')
        .pipe(() => throwingThenable, null, 'out')
        .error((error) => {
          expect(error.message).to.equal('then threw')
          done()
        }, 'error')
        .end()

      run()
    }))

  it('surfaces ambiguity errors through a synchronous nested next', () => {
    let handlerCalled = false
    const sp = superpipe({})
    const run = sp('nested-ambiguity')
      .pipe((next) => {
        next()
      }, 'next')
      .pipe((_next) => Promise.resolve('x'), 'next')
      .error(() => {
        handlerCalled = true
      })
      .end()

    expect(() => run()).to.throw('one continuation channel')
    expect(handlerCalled).to.equal(false)
  })
})

describe('promise continuation contract (guarded assimilation)', () => {
  it('routes a throwing then accessor to the error handler', () =>
    new Promise((done) => {
      const throwingAccessor = {
        get then() {
          throw new Error('accessor threw')
        },
      }
      const sp = superpipe({})
      const run = sp('throwing-accessor')
        .pipe(() => throwingAccessor, null, 'out')
        .error((error) => {
          expect(error.message).to.equal('accessor threw')
          done()
        }, 'error')
        .end()

      run()
    }))

  it('consumes a rejected promise returned alongside next', () => {
    const sp = superpipe({})
    const run = sp('ambiguous-rejected')
      .pipe((_next) => Promise.reject(new Error('mixed channels')), 'next')
      .end()

    expect(() => run()).to.throw('one continuation channel')
  })

  it('refuses a late next after an ambiguous continuation', async () => {
    let advanced = false
    const sp = superpipe({})
    const run = sp('late-next')
      .pipe(async (next) => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        next()
      }, 'next')
      .pipe(() => {
        advanced = true
      })
      .end()

    expect(() => run()).to.throw('one continuation channel')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(advanced).to.equal(false)
  })
})

describe('promise continuation contract (next buffering)', () => {
  it('does not advance when a pipe calls next and returns a thenable', async () => {
    let advanced = false
    const sp = superpipe({})
    const run = sp('sync-next-thenable')
      .pipe((next) => {
        next()
        return Promise.resolve('x')
      }, 'next')
      .pipe(() => {
        advanced = true
      })
      .end()

    expect(() => run()).to.throw('one continuation channel')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(advanced).to.equal(false)
  })

  it('invalidates every next callback when next is declared twice', async () => {
    let advanced = false
    const sp = superpipe({})
    const run = sp('double-next')
      .pipe(
        async (_first, second) => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          second()
        },
        ['next', 'next'],
      )
      .pipe(() => {
        advanced = true
      })
      .end()

    expect(() => run()).to.throw('one continuation channel')
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(advanced).to.equal(false)
  })

  it('invalidates a retained next when thenable inspection fails', async () => {
    let handlerRuns = 0
    let retainedNext
    const sp = superpipe({})
    const run = sp('accessor-invalidates')
      .pipe((next) => {
        retainedNext = next
        return {
          get then() {
            throw new Error('accessor threw')
          },
        }
      }, 'next')
      .error(() => {
        handlerRuns += 1
      }, 'error')
      .end()

    expect(() => run()).to.not.throw()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(handlerRuns).to.equal(1)

    expect(() => retainedNext()).to.not.throw()
    expect(handlerRuns).to.equal(1)
  })

  it('advances normally when a pipe declares next and returns undefined', () =>
    new Promise((done) => {
      const sp = superpipe({})
      const run = sp('buffer-flush')
        .pipe(
          (next) => {
            next(null, 'flushed')
          },
          'next',
          'value',
        )
        .pipe((value) => {
          expect(value).to.equal('flushed')
          done()
        }, 'value')
        .end()

      run()
    }))
})

describe('promise continuation contract (reentrancy)', () => {
  it('keeps buffered next callbacks invocation-local under reentrancy', () => {
    let downstreamRuns = 0
    const sp = superpipe({})
    let run
    run = sp('reentrant')
      .input(['depth'])
      .pipe(
        (next, depth) => {
          if (depth === undefined) {
            run(1)
          }
          next()
        },
        ['next', 'depth'],
      )
      .pipe(() => {
        downstreamRuns += 1
      })
      .end()

    run()

    expect(downstreamRuns).to.equal(2)
  })
})

describe('promise continuation contract (getter reentrancy)', () => {
  it('keeps the next collector invocation-local when a dependency getter re-enters', async () => {
    let advanced = false
    let reentered = false
    let run
    const sp = superpipe({
      get dep() {
        if (!reentered) {
          reentered = true
          try {
            run()
          } catch {}
        }
        return 'value'
      },
    })
    run = sp('getter-reentrancy')
      .pipe(
        (_dep, next) => {
          next()
          return Promise.resolve('x')
        },
        ['dep', 'next'],
      )
      .pipe(() => {
        advanced = true
      })
      .end()

    expect(() => run()).to.throw('one continuation channel')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(advanced).to.equal(false)
  })
})

describe('promise continuation contract (adoption timing and flush order)', () => {
  it('invokes a custom then method in a later promise job', () =>
    new Promise((done) => {
      let afterRun = false
      let observedInThen
      const sp = superpipe({})
      const run = sp('deferred-then')
        .pipe(
          () => ({
            then(resolve) {
              observedInThen = afterRun
              resolve('value')
            },
          }),
          null,
          'out',
        )
        .pipe((out) => {
          expect(out).to.equal('value')
          expect(observedInThen).to.equal(true)
          done()
        }, 'out')
        .end()

      run()
      afterRun = true
    }))

  it('flushes buffered next calls in invocation order, not declaration order', () =>
    new Promise((done) => {
      let observed
      const sp = superpipe({})
      const run = sp('flush-order')
        .pipe(
          (first, second) => {
            second(null, 'first-invoked')
            first(null, 'invoked-second')
          },
          ['next', 'next'],
          'val',
        )
        .pipe((val) => {
          observed = val
        }, 'val')
        .pipe(() => {
          expect(observed).to.equal('first-invoked')
          done()
        })
        .end()

      run()
    }))
})

describe('promise continuation contract (cleanup assimilation)', () => {
  it('consumes a nested rejected promise resolved during ambiguity cleanup', () => {
    const sp = superpipe({})
    const run = sp('nested-reject-ambiguity')
      .pipe(
        (_next) => ({
          then(resolve) {
            resolve(Promise.reject(new Error('nested')))
          },
        }),
        'next',
      )
      .end()

    expect(() => run()).to.throw('one continuation channel')

    return new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('invokes a then method whose call property is shadowed', () =>
    new Promise((done) => {
      const then = Object.assign((resolve) => resolve('ok'), { call: null })
      const sp = superpipe({})
      const run = sp('shadowed-call')
        .pipe(
          () => ({
            then: then,
          }),
          null,
          'out',
        )
        .pipe((out) => {
          expect(out).to.equal('ok')
          done()
        }, 'out')
        .end()

      run()
    }))
})

describe('promise continuation contract (failure timing and discards)', () => {
  it('defers a then accessor failure to the rejection path', () => {
    let handlerObservedAfterRun
    let afterRun = false
    const sp = superpipe({})
    const run = sp('accessor-timing')
      .pipe(
        () => ({
          get then() {
            throw new Error('accessor threw')
          },
        }),
        null,
        'out',
      )
      .error((error) => {
        expect(error.message).to.equal('accessor threw')
        handlerObservedAfterRun = afterRun
      }, 'error')
      .end()

    run()
    afterRun = true
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(handlerObservedAfterRun).to.equal(true)
        resolve()
      }, 10)
    })
  })

  it('discards a late externally scheduled next after ambiguity', async () => {
    let advanced = false
    const sp = superpipe({})
    const run = sp('external-late-next')
      .pipe((next) => {
        setTimeout(next, 5)
        return Promise.resolve('x')
      }, 'next')
      .pipe(() => {
        advanced = true
      })
      .end()

    expect(() => run()).to.throw('one continuation channel')

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(advanced).to.equal(false)
  })
})

describe('promise continuation contract (guard order and native adoption)', () => {
  it('discards a repeat call on a disabled callback before the duplicate check', async () => {
    let advanced = false
    let retained
    const sp = superpipe({})
    const run = sp('disabled-before-called')
      .pipe((next) => {
        retained = next
        next()
        return Promise.resolve('x')
      }, 'next')
      .pipe(() => {
        advanced = true
      })
      .end()

    expect(() => run()).to.throw('one continuation channel')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(() => retained()).to.not.throw()
    expect(advanced).to.equal(false)
  })

  it('adopts a settled native promise in ordinary reaction ordering', () =>
    new Promise((done) => {
      const order = []
      const sp = superpipe({})
      const run = sp('native-ordering')
        .pipe(() => Promise.resolve('v'), null, 'out')
        .pipe(() => {
          order.push('pipeline')
        }, 'out')
        .end()

      run()
      Promise.resolve().then(() => {
        order.push('caller-microtask')

        expect(order).to.deep.equal(['pipeline', 'caller-microtask'])
        done()
      })
    }))
})

describe('promise continuation contract (native subclass adoption)', () => {
  it('routes a throwing then override on a native promise subclass to the error handler', () =>
    new Promise((done) => {
      class ThrowingThen extends Promise {
        then() {
          throw new Error('subclass then threw')
        }
      }
      const sp = superpipe({})
      const run = sp('subclass-then')
        .pipe(() => new ThrowingThen(() => {}), null, 'out')
        .error((error) => {
          expect(error.message).to.equal('subclass then threw')
          done()
        }, 'error')
        .end()

      expect(() => run()).to.not.throw()
    }))
})

describe('promise continuation contract (hostile overrides)', () => {
  it('ignores repeated settlements from a hostile then override', () => {
    let handlerRuns = 0
    let downstreamRuns = 0
    class Hostile extends Promise {
      then(onFulfilled, onRejected) {
        if (onFulfilled) {
          onFulfilled('first')

          onRejected(new Error('should never surface'))
        }
        return new Promise(() => {})
      }
    }
    const sp = superpipe({})
    const run = sp('double-settle')
      .pipe(() => new Hostile(() => {}), null, 'out')
      .pipe(() => {
        downstreamRuns += 1
      }, 'out')
      .pipe(() => {
        downstreamRuns += 1
      })
      .error(() => {
        handlerRuns += 1
      })
      .end()

    run()
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(downstreamRuns).to.equal(2)
        expect(handlerRuns).to.equal(0)
        resolve()
      }, 10)
    })
  })

  it('consumes a rejected native subclass whose then override throws in cleanup', () => {
    class RejectedThrowing extends Promise {
      then() {
        throw new Error('override threw')
      }
    }
    const sp = superpipe({})
    const run = sp('cleanup-rejection')
      .pipe(() => new RejectedThrowing((_resolve, reject) => reject(new Error('original'))), 'next')
      .end()

    expect(() => run()).to.throw('one continuation channel')

    return new Promise((resolve) => setTimeout(resolve, 20))
  })
})

describe('promise continuation contract (proxies and deferred overrides)', () => {
  it('adopts a proxied thenable whose prototype trap throws', () =>
    new Promise((done) => {
      const target = {
        then(resolve) {
          resolve('proxied')
        },
      }
      const proxy = new Proxy(target, {
        getPrototypeOf() {
          throw new Error('trap threw')
        },
      })
      const sp = superpipe({})
      const run = sp('proxy-thenable')
        .pipe(() => proxy, null, 'out')
        .pipe((out) => {
          expect(out).to.equal('proxied')
          done()
        }, 'out')
        .end()

      expect(() => run()).to.not.throw()
    }))

  it('defers a then override that invokes its callback synchronously', () =>
    new Promise((done) => {
      let afterRun = false
      class SyncThen extends Promise {
        then(onFulfilled) {
          if (onFulfilled) {
            onFulfilled('sync')
          }
          return new Promise(() => {})
        }
      }
      const sp = superpipe({})
      const run = sp('sync-override-deferred')
        .pipe(() => new SyncThen(() => {}), null, 'out')
        .pipe(() => {
          expect(afterRun).to.equal(true)
          done()
        }, 'out')
        .end()

      run()
      afterRun = true
    }))
})

describe('promise continuation contract (settlement edge cases)', () => {
  it('ignores an override throw after fulfillment', () => {
    let handlerRuns = 0
    class SettleThenThrow extends Promise {
      then(resolve) {
        resolve('value')
        throw new Error('threw after settling')
      }
    }
    const sp = superpipe({})
    const run = sp('settle-then-throw')
      .pipe(() => new SettleThenThrow(() => {}), null, 'out')
      .pipe((out) => {
        expect(out).to.equal('value')
      }, 'out')
      .error(() => {
        handlerRuns += 1
      })
      .end()

    expect(() => run()).to.not.throw()
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(handlerRuns).to.equal(0)
        resolve()
      }, 10)
    })
  })

  it('consumes the original rejection when an adoption override throws', () => {
    class RejectedThrowing extends Promise {
      then() {
        throw new Error('override threw')
      }
    }
    let observed
    const sp = superpipe({})
    const run = sp('adoption-rejection')
      .pipe(
        () => new RejectedThrowing((_resolve, reject) => reject(new Error('original'))),
        null,
        'out',
      )
      .error((error) => {
        observed = error.message
      }, 'error')
      .end()

    expect(() => run()).to.not.throw()
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(observed).to.equal('override threw')
        resolve()
      }, 10)
    })
  })

  it('assimilates a nested thenable resolved by an override', () =>
    new Promise((done) => {
      class NestedResolve extends Promise {
        then(resolve) {
          resolve(Promise.resolve('nested-adopted'))
        }
      }
      const sp = superpipe({})
      const run = sp('nested-adopt')
        .pipe(() => new NestedResolve(() => {}), null, 'out')
        .pipe((out) => {
          expect(out).to.equal('nested-adopted')
          done()
        }, 'out')
        .end()

      run()
    }))
})

describe('promise continuation contract (rejection observation)', () => {
  it('observes the original rejection when the then getter throws', () => {
    const promise = Promise.reject(new Error('original'))
    Object.defineProperty(promise, 'then', {
      get() {
        throw new Error('getter threw')
      },
    })
    let observed
    const sp = superpipe({})
    const run = sp('getter-throw-rejection')
      .pipe(() => promise, null, 'out')
      .error((error) => {
        observed = error.message
      }, 'error')
      .end()

    expect(() => run()).to.not.throw()
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(observed).to.equal('getter threw')
        resolve()
      }, 10)
    })
  })

  it('never invokes a thenable rejection reason during cleanup', async () => {
    let reasonThenCalls = 0
    const reason = {
      then() {
        reasonThenCalls += 1
      },
    }
    const sp = superpipe({})
    const run = sp('opaque-reason')
      .pipe(() => Promise.reject(reason), 'next')
      .end()

    expect(() => run()).to.throw('one continuation channel')
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(reasonThenCalls).to.equal(0)
  })
})

describe('promise continuation contract (verified observation)', () => {
  it('consumes the captured thenable when the brand check false-positives', () => {
    let consumed = false
    const slotless = Object.create(Promise.prototype)

    slotless.then = (resolve) => {
      consumed = true
      resolve('slotless-value')
    }
    const sp = superpipe({})
    const run = sp('slotless-brand')
      .pipe(() => slotless, 'next')
      .end()

    expect(() => run()).to.throw('one continuation channel')
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(consumed).to.equal(true)
        resolve()
      }, 10)
    })
  })

  it('observes a rejected subclass whose override swallows the rejection', () => {
    class SwallowingOverride extends Promise {
      then(onFulfilled) {
        if (onFulfilled) {
          onFulfilled('synthetic')
        }
        return new Promise(() => {})
      }
    }
    let observed
    const sp = superpipe({})
    const run = sp('swallowing-override')
      .pipe(
        () => new SwallowingOverride((_res, reject) => reject(new Error('original'))),
        null,
        'out',
      )
      .pipe((out) => {
        observed = out
      }, 'out')
      .end()

    run()
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(observed).to.equal('synthetic')
        resolve()
      }, 10)
    })
  })

  it('discards a pending promise continuation after an error wins', async () => {
    let handlerRuns = 0
    let resolveLate
    const sp = superpipe({})
    const run = sp('error-wins')
      .pipe((next) => {
        next()
        throw new Error('first error')
      }, 'next')
      .pipe(
        () =>
          new Promise((resolve) => {
            resolveLate = resolve
          }),
        null,
        'late',
      )
      .error(() => {
        handlerRuns += 1
      }, 'error')
      .end()

    expect(() => run()).to.not.throw()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(handlerRuns).to.equal(1)
    resolveLate('late-value')
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(handlerRuns).to.equal(1)
  })
})

describe('endAsync contract', () => {
  it('resolves a fully synchronous pipeline immediately', async () => {
    const sp = superpipe({})
    const run = sp('endasync-sync')
      .pipe(() => 'v', null, 'out')
      .endAsync('out')

    await expect(run()).resolves.toEqual('v')
  })

  it('resolves a promise-returning pipeline after it settles', async () => {
    const sp = superpipe({})
    const run = sp('endasync-promise')
      .pipe(() => Promise.resolve('async-value'), null, 'out')
      .endAsync('out')

    await expect(run()).resolves.toEqual('async-value')
  })

  it('resolves a next-based pipeline after the callback fires', async () => {
    const sp = superpipe({})
    const run = sp('endasync-next')
      .pipe(
        (next) => {
          setTimeout(() => next(null, 'late-value'), 5)
        },
        'next',
        'out',
      )
      .endAsync('out')

    await expect(run()).resolves.toEqual('late-value')
  })

  it('resolves undefined when no output spec is given', async () => {
    const sp = superpipe({})
    const run = sp('endasync-no-output')
      .pipe(() => 'v', null, 'out')
      .endAsync()

    await expect(run()).resolves.toEqual(undefined)
  })

  it('rejects a failed run instead of throwing synchronously', async () => {
    const sp = superpipe({})
    const run = sp('endasync-no-handler')
      .pipe(() => {
        throw new Error('boom')
      })
      .endAsync('out')

    await expect(run()).rejects.toThrow('boom')
  })

  it('runs the error handler and still rejects', async () => {
    let handlerRuns = 0
    const sp = superpipe({})
    const run = sp('endasync-with-handler')
      .pipe(() => Promise.reject(new Error('async boom')))
      .error(() => {
        handlerRuns += 1
      }, 'error')
      .endAsync('out')

    await expect(run()).rejects.toThrow('async boom')
    expect(handlerRuns).to.equal(1)
  })

  it('resolves a halted run with the partial snapshot', async () => {
    const sp = superpipe({ isBlocked: false })
    const run = sp('endasync-halted')
      .input(['user'])
      .pipe(() => 'kept-value', null, 'kept')
      .pipe('isBlocked', 'user')
      .pipe(() => 'never', null, 'never')
      .endAsync('kept')

    await expect(run()).resolves.toEqual('kept-value')
  })

  it('rejects once when a pending continuation races an error', async () => {
    let rejections = 0
    const sp = superpipe({})
    const run = sp('endasync-error-wins')
      .pipe((next) => {
        next()
        throw new Error('first error')
      }, 'next')
      .pipe(
        () =>
          new Promise((resolve) => {
            setTimeout(resolve, 5)
          }),
        null,
        'late',
      )
      .error(() => {}, 'error')
      .endAsync('out')

    await run().catch(() => {
      rejections += 1
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(rejections).to.equal(1)
  })

  it('rejects even when a throwing handler runs', async () => {
    const sp = superpipe({})
    const run = sp('endasync-throwing-handler')
      .pipe(() => {
        throw new Error('original')
      })
      .error(() => {
        throw new Error('handler exploded')
      }, 'error')
      .endAsync('out')

    await expect(run()).rejects.toThrow('original')
  })
})

describe('endAsync contract (settlement edge cases)', () => {
  it('settles a promise-based flow-control halt', async () => {
    const sp = superpipe({ isBlocked: async () => true })
    const run = sp('endasync-promise-halt')
      .input(['user'])
      .pipe('!isBlocked', 'user')
      .pipe(() => 'never', null, 'never')
      .endAsync('out')

    await expect(run()).resolves.toEqual(undefined)
  })

  it('rejects when an async continuation raises a namespace error', async () => {
    const sp = superpipe({})
    const run = sp('endasync-async-namespace')
      // Spread object return merges a reserved name from a microtask.
      .pipe(() => Promise.resolve({ next: () => {} }), null, '{...}')
      .endAsync('out')

    await expect(run()).rejects.toThrow('reserved')
  })

  it('rejects when an error wins after a synchronous flush completes the run', async () => {
    const sp = superpipe({})
    const run = sp('endasync-flush-error')
      .pipe((next) => {
        next()
        throw new Error('pipe error')
      }, 'next')
      .pipe(() => 'done', null, 'out')
      .error(() => {}, 'error')
      .endAsync('out')

    await expect(run()).rejects.toThrow('pipe error')
  })
})

describe('endAsync contract (foreign-stack exceptions)', () => {
  it('rejects when a retained next raises from a foreign callback stack', async () => {
    const sp = superpipe({})
    const run = sp('endasync-late-next-throw')
      .pipe(
        (next) => {
          // The reserved-name merge throws after runPipeline returned, on
          // the timer's stack.
          setTimeout(() => next(null, { next: () => {} }), 5)
        },
        'next',
        '{...}',
      )
      .endAsync('out')

    await expect(run()).rejects.toThrow('reserved')
  })

  it('rejects when the settled output lookup throws', async () => {
    const functions = {
      get out() {
        throw new Error('getter threw')
      },
    }
    const sp = superpipe(functions)
    const run = sp('endasync-fetch-throw')
      .pipe(() => 'v', null, 'value')
      .endAsync('out')

    await expect(run()).rejects.toThrow('getter threw')
  })

  it('surfaces async failures as unhandled rejections for sync .end() runs', async () => {
    const seen = []
    const onUnhandled = (err) => seen.push(err)
    process.on('unhandledRejection', onUnhandled)
    const sp = superpipe({})
    const run = sp('end-async-unhandled')
      .pipe(() => Promise.reject(new Error('boom')))
      .end()

    run()
    await new Promise((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', onUnhandled)

    expect(seen.length).to.equal(1)
    expect(seen[0].message).to.equal('boom')
  })
})

describe('endAsync contract (in-flight continuations)', () => {
  it('waits for an in-flight continuation before settling and merges through its own pipe', async () => {
    let resolveAsync
    let settledEarly = false
    const sp = superpipe({})
    const run = sp('endasync-inflight')
      .pipe(
        (first, second) => {
          first()
          second()
        },
        ['next', 'next'],
      )
      .pipe(
        () =>
          new Promise((resolve) => {
            resolveAsync = resolve
          }),
        null,
        'late',
      )
      .pipe(() => 'done', null, 'out')
      .endAsync('{late, out}')

    const outcome = run()
    outcome.then(() => {
      settledEarly = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(settledEarly).to.equal(false)

    resolveAsync('late-value')

    await expect(outcome).resolves.toEqual({ late: 'late-value', out: 'done' })
  })
})

describe('endAsync contract (sibling continuations)', () => {
  it('does not fabricate output from a rejected continuation', async () => {
    let observedOut = 'unset'
    const sp = superpipe({})
    const run = sp('endasync-reject-index')
      .pipe(() => Promise.reject(new Error('reject')), null, 'out')
      .error(
        (_error, out) => {
          observedOut = out
        },
        ['error', 'out'],
      )
      .endAsync('out')

    await expect(run()).rejects.toThrow('reject')
    expect(observedOut).to.equal(undefined)
  })

  it('waits for other in-flight continuations when an async guard halts', async () => {
    let resolveAsync
    let settledEarly = false
    const sp = superpipe({ allow: async () => true })
    const run = sp('endasync-async-halt-pending')
      .input(['user'])
      .pipe(
        (first, second) => {
          first()
          second()
        },
        ['next', 'next'],
      )
      .pipe(
        () =>
          new Promise((resolve) => {
            resolveAsync = resolve
          }),
        null,
        'late',
      )
      .pipe('!allow', 'user')
      .endAsync('{late}')

    const outcome = run({ role: 'admin' })
    outcome.then(() => {
      settledEarly = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(settledEarly).to.equal(false)

    resolveAsync('late-value')
    await expect(outcome).resolves.toEqual({ late: 'late-value' })
  })

  it('marks continuation exceptions terminal for other in-flight continuations', async () => {
    let sideEffect = false
    let retained
    const sp = superpipe({})
    const run = sp('endasync-exception-terminal')
      .pipe(
        (first, second) => {
          first()
          retained = second
        },
        ['next', 'next'],
      )
      // Resolves with a reserved name — its spread merge raises OutputNameError.
      .pipe(() => Promise.resolve({ next: () => {} }), null, '{...}')
      .pipe(() => {
        sideEffect = true
      })
      .endAsync('out')

    const outcome = run()

    const assertion = expect(outcome).rejects.toThrow('reserved')
    await new Promise((resolve) => setTimeout(resolve, 10))

    retained(null, { next: () => {} })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await assertion

    expect(sideEffect).to.equal(false)
  })
})

describe('endAsync contract (halt preservation)', () => {
  it('preserves a halt while sibling continuations finish', async () => {
    let sideEffect = false
    let resolveSlow
    const sp = superpipe({ allow: async () => true })
    const run = sp('endasync-halt-preserved')
      .input(['user'])
      .pipe(
        (first, second) => {
          first()
          second()
        },
        ['next', 'next'],
      )
      .pipe(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve
          }),
        null,
        'late',
      )
      .pipe('!allow', 'user')
      .pipe(() => {
        sideEffect = true
      }, 'late')
      .endAsync('{late}')

    const outcome = run({ role: 'admin' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    resolveSlow('late-value')
    const result = await outcome

    expect(result.late).to.equal('late-value')
    expect(sideEffect).to.equal(false)
  })
})

describe('endAsync contract (retained continuations)', () => {
  it('waits for a retained next callback before resolving', async () => {
    let settledEarly = false
    let retained
    const sp = superpipe({})
    const run = sp('endasync-retained-next')
      .pipe(
        (first, second) => {
          first()
          retained = second
        },
        ['next', 'next'],
      )
      .pipe(() => 'done', null, 'out')
      .endAsync('out')

    const outcome = run()
    outcome.then(() => {
      settledEarly = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(settledEarly).to.equal(false)

    retained()
    await expect(outcome).resolves.toEqual('done')
  })

  it('rejects when a retained next callback delivers an error late', async () => {
    let retained
    const sp = superpipe({})
    const run = sp('endasync-retained-error')
      .pipe(
        (_first, second) => {
          retained = second
        },
        ['next', 'next'],
      )
      .pipe(() => 'done', null, 'out')
      .error(() => {}, 'error')
      .endAsync('out')

    const outcome = run()
    const assertion = expect(outcome).rejects.toThrow('late failure')
    retained(new Error('late failure'))
    await assertion
  })
})

describe('endAsync contract (wrapper lifecycle)', () => {
  it('settles when an optional pipe declaring next is skipped', async () => {
    const sp = superpipe({})
    const run = sp('endasync-optional-next')
      .input(['user'])
      .pipe('?missing', ['next', 'missingValue'], 'out')
      .pipe(() => 'done', null, 'done')
      .endAsync('done')

    await expect(run()).resolves.toEqual('done')
  })

  it('discards a retained next after the run failed', async () => {
    let retained
    let handlerRuns = 0
    const sp = superpipe({})
    const run = sp('endasync-retained-after-error')
      .pipe(
        (_first, second) => {
          retained = second
          throw new Error('pipe error')
        },
        ['next', 'next'],
      )
      .error(() => {
        handlerRuns += 1
      }, 'error')
      .endAsync('out')

    const outcome = run()
    const assertion = expect(outcome).rejects.toThrow('pipe error')
    await new Promise((resolve) => setTimeout(resolve, 10))
    // A late callback after the terminal error is discarded — no merge, no
    // throw onto the test's stack.
    retained(null, { next: () => {} })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await assertion
    expect(handlerRuns).to.equal(1)
  })

  it('binds a retained next value to its originating pipe', async () => {
    let retained
    const sp = superpipe({})
    const run = sp('endasync-retained-fromstep')
      .pipe(
        (first, second) => {
          retained = second
          first()
        },
        ['next', 'next'],
        'firstValue',
      )
      .pipe(() => 'second-value', null, 'secondValue')
      .endAsync('{firstValue, secondValue}')

    const outcome = run()
    await new Promise((resolve) => setTimeout(resolve, 10))
    retained(null, 'the-first-value')

    await expect(outcome).resolves.toEqual({
      firstValue: 'the-first-value',
      secondValue: 'second-value',
    })
  })
})

describe('endAsync contract (late-callback handlers)', () => {
  it('swallows a throwing handler invoked from a late callback', async () => {
    let retained
    const seen = []
    const onUnhandled = (err) => seen.push(err)
    const sp = superpipe({})
    const run = sp('endasync-throwing-handler-late')
      .pipe(
        (_first, second) => {
          retained = second
        },
        ['next', 'next'],
      )
      .error(() => {
        throw new Error('handler exploded')
      }, 'error')
      .endAsync('out')

    const outcome = run()
    const assertion = expect(outcome).rejects.toThrow('late error')
    await new Promise((resolve) => setTimeout(resolve, 5))
    process.on('unhandledRejection', onUnhandled)
    setTimeout(() => retained(new Error('late error')), 5)
    await new Promise((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', onUnhandled)
    await assertion

    expect(seen).to.deep.equal([])
  })

  it('binds held next values to their originating pipe', async () => {
    const sp = superpipe({})
    const run = sp('endasync-held-fromstep')
      .pipe(
        (first, second) => {
          first(null, 'first-value')
          second(null, 'second-value')
        },
        ['next', 'next'],
        'value',
      )
      .pipe((v) => 'next:' + v, 'value', 'downstream')
      .endAsync('{value, downstream}')

    const result = await run()

    expect(result).toEqual({ value: 'second-value', downstream: 'next:first-value' })
  })
})

describe('endAsync contract (downstream deferral)', () => {
  it('defers downstream pipes until sibling continuations merge', async () => {
    let resolveA
    const sp = superpipe({})
    const run = sp('endasync-sibling-order')
      .pipe(
        (first, second) => {
          first()
          second()
        },
        ['next', 'next'],
      )
      .pipe(
        () =>
          new Promise((resolve) => {
            resolveA = resolve
          }),
        null,
        'a',
      )
      .pipe((a, b) => [a, b], ['a', 'b'], ['first', 'second'])
      .endAsync('{first, second}')

    const outcome = run()
    await new Promise((resolve) => setTimeout(resolve, 10))

    resolveA('a-value')
    await expect(outcome).resolves.toEqual({ first: 'a-value', second: undefined })
  })
})

describe('endAsync contract (duplicate callbacks)', () => {
  it('routes duplicate late callbacks into the settlement', async () => {
    let retained
    const sp = superpipe({})
    const run = sp('endasync-duplicate-late')
      .pipe((next) => {
        retained = next
      }, 'next')
      .pipe(() => 'done', null, 'done')
      .endAsync('done')

    const outcome = run()
    const assertion = expect(outcome).rejects.toThrow('more than once')
    retained()
    retained()
    await assertion
  })
})

describe('endAsync contract (boolean dependencies)', () => {
  it('evaluates a raw boolean dependency normally despite a next input', async () => {
    const sp = superpipe({ enabled: true })
    const run = sp('endasync-bool-with-next')
      .input(['user'])
      .pipe('enabled', 'next')
      .pipe(() => 'done', null, 'done')
      .endAsync('done')

    await expect(run()).resolves.toEqual('done')
  })

  it('halts on a false raw boolean dependency despite a next input', async () => {
    const sp = superpipe({ enabled: false })
    const run = sp('endasync-bool-with-next-halt')
      .input(['user'])
      .pipe('enabled', 'next')
      .pipe(() => 'never', null, 'never')
      .endAsync('never')

    await expect(run()).resolves.toEqual(undefined)
  })
})

describe('endAsync contract (object-form next keys)', () => {
  it('deduplicates a repeated next key in object-string inputs', async () => {
    const sp = superpipe({})
    const run = sp('endasync-objstring-dup')
      .pipe(({ next }) => {
        next()
      }, '{next, next}')
      .pipe(() => 'done', null, 'done')
      .endAsync('done')

    await expect(run()).resolves.toEqual('done')
  })
})

describe('endAsync abort contract', () => {
  it('rejects with PipelineAbortedError when the signal aborts mid-run', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-mid-run')
      .pipe(() => new Promise(() => {}), null, 'never')
      .endAsync('out')

    const promise = run.withSignal(controller.signal)
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)
  })

  it('carries the AbortError name and preserves the signal reason', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-reason')
      .pipe(() => new Promise(() => {}), null, 'never')
      .endAsync('out')

    const promise = run.withSignal(controller.signal)
    controller.abort('custom-reason')
    const err = await promise.catch((e) => e)
    expect(err).toBeInstanceOf(PipelineAbortedError)
    expect(err.name).to.equal('AbortError')
    expect(err.reason).to.equal('custom-reason')
  })

  it('does not route an abort through the error handler', async () => {
    let handlerRuns = 0
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-no-handler')
      .pipe(() => new Promise(() => {}), null, 'never')
      .error(() => {
        handlerRuns += 1
      }, 'error')
      .endAsync('out')

    const promise = run.withSignal(controller.signal)
    controller.abort()
    await promise.catch(() => {})
    expect(handlerRuns).to.equal(0)
  })

  it('discards a late pipeline error after an abort', async () => {
    let handled = null
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-then-late-error')
      .pipe(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('late failure')), 10)
          }),
        null,
        'out',
      )
      .error((error) => {
        handled = error
      }, 'error')
      .endAsync('out')

    const promise = run.withSignal(controller.signal)
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(handled).to.equal(null)
  })

  it('skips pipes that have not started when the signal aborts mid-run', async () => {
    const controller = new AbortController()
    let resolveFourth
    const ran = []
    const sp = superpipe({})
    const run = sp('abort-skips-rest')
      .pipe(
        () => {
          ran.push(1)
          return 'a'
        },
        null,
        'a',
      )
      .pipe(
        () => {
          ran.push(2)
          return 'b'
        },
        null,
        'b',
      )
      .pipe(
        () => {
          ran.push(3)
          return 'c'
        },
        null,
        'c',
      )
      .pipe(
        () =>
          new Promise((resolve) => {
            resolveFourth = resolve
          }),
        null,
        'd',
      )
      .pipe(
        () => {
          ran.push(5)
          return 'e'
        },
        null,
        'e',
      )
      .endAsync('e')

    const promise = run.withSignal(controller.signal)
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller.abort()
    resolveFourth('too late')
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(ran).to.deep.equal([1, 2, 3])
  })

  it('skips remaining pipes when a pipe aborts during the initial cascade', async () => {
    const controller = new AbortController()
    let secondRan = false
    const sp = superpipe({})
    const run = sp('abort-cascade-skip')
      .pipe(
        () => {
          controller.abort()
          return 'a'
        },
        null,
        'a',
      )
      .pipe(
        () => {
          secondRan = true
          return 'b'
        },
        null,
        'b',
      )
      .endAsync('b')

    await expect(run.withSignal(controller.signal)).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(secondRan).to.equal(false)
  })

  it('disables retained next callbacks when the signal aborts', async () => {
    let retained
    let handlerRuns = 0
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-retained-freed')
      .pipe(
        (first, second) => {
          retained = second
          first(null, 'value')
        },
        ['next', 'next'],
        'value',
      )
      .pipe(() => 'done', null, 'done')
      .error(() => {
        handlerRuns += 1
      }, 'error')
      .endAsync('done')

    const promise = run.withSignal(controller.signal)

    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)

    expect(() => retained(null, 'late')).to.not.throw()
    expect(handlerRuns).to.equal(0)
  })

  it('rejects without running pipes when addEventListener throws', async () => {
    let ran = false
    const signal = {
      aborted: false,
      addEventListener() {
        throw new Error('non-conforming signal')
      },
      removeEventListener() {},
    }
    const sp = superpipe({})
    const run = sp('abort-throwing-add')
      .pipe(
        () => {
          ran = true
          return 'x'
        },
        null,
        'out',
      )
      .endAsync('out')

    const err = await run.withSignal(signal).catch((e) => e)
    expect(err.message).to.equal('non-conforming signal')
    expect(ran).to.equal(false)
  })

  it('keeps the runner reusable after an aborted run', async () => {
    const sp = superpipe({})
    const run = sp('abort-runner-reusable')
      .pipe(() => 'done', null, 'out')
      .endAsync('out')

    const first = new AbortController()
    const aborted = run.withSignal(first.signal)
    first.abort()
    await expect(aborted).rejects.toBeInstanceOf(PipelineAbortedError)

    const second = new AbortController()
    await expect(run.withSignal(second.signal)).resolves.toEqual('done')
    await expect(run()).resolves.toEqual('done')
  })

  it('cancels concurrent runs from one runner independently', async () => {
    let resolveA
    let resolveB
    const sp = superpipe({})
    const runA = sp('abort-independent-a')
      .pipe(
        () =>
          new Promise((resolve) => {
            resolveA = resolve
          }),
        null,
        'out',
      )
      .endAsync('out')
    const runB = sp('abort-independent-b')
      .pipe(
        () =>
          new Promise((resolve) => {
            resolveB = resolve
          }),
        null,
        'out',
      )
      .endAsync('out')

    const controllerA = new AbortController()
    const controllerB = new AbortController()
    const pa = runA.withSignal(controllerA.signal)
    const pb = runB.withSignal(controllerB.signal)

    controllerA.abort()
    await expect(pa).rejects.toBeInstanceOf(PipelineAbortedError)

    resolveA('late')
    resolveB('kept')
    await expect(pb).resolves.toEqual('kept')
  })

  it('preserves the reason on a pre-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort('pre-reason')
    const sp = superpipe({})
    const run = sp('abort-pre-reason')
      .pipe(() => new Promise(() => {}), null, 'never')
      .endAsync('out')

    const err = await run.withSignal(controller.signal).catch((e) => e)
    expect(err).toBeInstanceOf(PipelineAbortedError)
    expect(err.reason).to.equal('pre-reason')
  })

  it('short-circuits a pre-aborted signal before any pipe runs', async () => {
    let ran = false
    const controller = new AbortController()
    controller.abort()
    const sp = superpipe({})
    const run = sp('abort-pre')
      .pipe(
        () => {
          ran = true
          return 'x'
        },
        null,
        'out',
      )
      .endAsync('out')

    await expect(run.withSignal(controller.signal)).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(ran).to.equal(false)
  })

  it('rejects immediately without waiting for a pending adopted promise', async () => {
    const controller = new AbortController()
    let resolved = false
    const sp = superpipe({})
    const run = sp('abort-pending-promise')
      .pipe(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolved = true
              resolve('slow')
            }, 100)
          }),
        null,
        'out',
      )
      .endAsync('out')

    const promise = run.withSignal(controller.signal)
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)

    expect(resolved).to.equal(false)
  })

  it('abort wins over a later promise rejection without an unhandled rejection', async () => {
    const seen = []
    const onUnhandled = (err) => seen.push(err)
    process.on('unhandledRejection', onUnhandled)

    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-vs-reject')
      .pipe(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('too late')), 20)
          }),
        null,
        'out',
      )
      .endAsync('out')

    const promise = run.withSignal(controller.signal)
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)

    await new Promise((resolve) => setTimeout(resolve, 40))
    process.off('unhandledRejection', onUnhandled)
    expect(seen).to.deep.equal([])
  })

  it('rejects a run aborted synchronously right after it completes', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-same-tick')
      .pipe(() => 'done', null, 'out')
      .endAsync('out')

    const promise = run.withSignal(controller.signal)
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)
  })

  it('proceeds normally when the aborted getter throws', async () => {
    const signal = {
      get aborted() {
        throw new Error('getter exploded')
      },
      addEventListener() {},
      removeEventListener() {},
    }
    const sp = superpipe({})
    const run = sp('abort-throwing-aborted-getter')
      .pipe(() => 'done', null, 'out')
      .endAsync('out')

    await expect(run.withSignal(signal)).resolves.toEqual('done')
  })

  it('tolerates a throwing reason getter when aborting', async () => {
    let listener
    const signal = {
      aborted: false,
      get reason() {
        throw new Error('reason getter exploded')
      },
      addEventListener(_type, fn) {
        listener = fn
      },
      removeEventListener() {},
    }
    const sp = superpipe({})
    const run = sp('abort-throwing-reason-getter')
      .pipe(() => new Promise(() => {}), null, 'never')
      .endAsync('out')

    const promise = run.withSignal(signal)
    listener()
    const err = await promise.catch((e) => e)
    expect(err).toBeInstanceOf(PipelineAbortedError)

    expect(err.reason).to.equal(undefined)
  })

  it('never attaches a listener on the pre-aborted short-circuit', async () => {
    let active = 0
    const signal = {
      aborted: true,
      addEventListener() {
        active += 1
      },
      removeEventListener() {
        active -= 1
      },
    }
    const sp = superpipe({})
    const run = sp('abort-pre-detach')
      .pipe(() => new Promise(() => {}), null, 'never')
      .endAsync('out')

    await expect(run.withSignal(signal)).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(active).to.equal(0)
  })

  it('detaches listeners from concurrent runs sharing one controller', async () => {
    let active = 0
    const controller = new AbortController()
    const signal = {
      get aborted() {
        return controller.signal.aborted
      },
      addEventListener(_type, fn) {
        active += 1
        controller.signal.addEventListener('abort', fn)
      },
      removeEventListener(_type, fn) {
        active -= 1
        controller.signal.removeEventListener('abort', fn)
      },
    }
    const sp = superpipe({})
    const run = sp('abort-shared-controller')
      .pipe(() => 'done', null, 'out')
      .endAsync('out')

    const [first, second] = await Promise.all([run.withSignal(signal), run.withSignal(signal)])
    expect(first).to.equal('done')
    expect(second).to.equal('done')
    expect(active).to.equal(0)
  })

  it('ignores an abort after the run already completed', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-after-complete')
      .pipe(() => 'done', null, 'out')
      .endAsync('out')

    const value = await run.withSignal(controller.signal)
    controller.abort()
    expect(value).to.equal('done')
  })

  it('runs without cancellation when no signal is supplied', async () => {
    const sp = superpipe({})
    const run = sp('abort-no-signal')
      .pipe(() => 'done', null, 'out')
      .endAsync('out')

    await expect(run()).resolves.toEqual('done')
  })

  it('does not touch the synchronous .end path', () => {
    const sp = superpipe({})
    const run = sp('abort-sync-end')
      .pipe(() => 'done', null, 'out')
      .end('out')

    expect(run()).to.equal('done')
  })

  it('supports plain AbortSignal-shaped objects without a reason', async () => {
    let listener
    const signal = {
      aborted: false,
      addEventListener(_type, fn) {
        listener = fn
      },
      removeEventListener() {
        listener = undefined
      },
    }
    const sp = superpipe({})
    const run = sp('abort-structural')
      .pipe(() => new Promise(() => {}), null, 'never')
      .endAsync('out')

    const promise = run.withSignal(signal)
    listener()
    const err = await promise.catch((e) => e)
    expect(err).toBeInstanceOf(PipelineAbortedError)

    expect(err.reason).to.equal(undefined)
  })

  it('rejects when a pipe aborts synchronously during the initial cascade', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-sync-in-pipe')
      .pipe(
        () => {
          controller.abort()
        },
        null,
        'a',
      )
      .pipe(() => new Promise(() => {}), null, 'b')
      .endAsync('b')

    await expect(run.withSignal(controller.signal)).rejects.toBeInstanceOf(PipelineAbortedError)
  })

  it('detaches the abort listener when the run completes first', async () => {
    let active = 0
    const signal = {
      aborted: false,
      addEventListener(_type, fn) {
        active += 1
        this._fn = fn
      },
      removeEventListener() {
        active -= 1
      },
    }
    const sp = superpipe({})
    const run = sp('abort-detach-on-complete')
      .pipe(() => 'done', null, 'out')
      .endAsync('out')

    await expect(run.withSignal(signal)).resolves.toEqual('done')
    expect(active).to.equal(0)
  })

  it('detaches the abort listener when the abort wins', async () => {
    let active = 0
    let listener
    const signal = {
      aborted: false,
      addEventListener(_type, fn) {
        active += 1
        listener = fn
      },
      removeEventListener() {
        active -= 1
      },
    }
    const sp = superpipe({})
    const run = sp('abort-detach-on-abort')
      .pipe(() => new Promise(() => {}), null, 'never')
      .endAsync('out')

    const promise = run.withSignal(signal)
    listener()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(active).to.equal(0)
  })
})
