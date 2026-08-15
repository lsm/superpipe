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
 */
import { describe, expect, it } from 'vitest'
import superpipe from '../src'

describe('Flow-control contract (README-pinned behaviors)', () => {
  // --- control: MUST pass on every branch, else the harness is broken ---
  // Uses two positional args (both branches wrap multiple args into an array
  // identically) so input mapping is unambiguous.
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

  // --- 1. false-return stops the pipeline (DISCRIMINATOR) ---
  describe('boolean flow control — return false stops the pipeline', () => {
    it('halts when a pipe returns false; no subsequent pipe runs', () => {
      let afterRan = false
      const sp = superpipe({})
      const run = sp('false-stop')
        .pipe(() => false) // returns false, does not request next → must halt
        .pipe(() => {
          afterRan = true
        }) // sentinel — must NOT run
        .end()

      run()
      expect(afterRan).to.equal(false)
    })
  })

  // --- 2. `!` not-pipe inverts the boolean ---
  describe('! not-pipes — invert the boolean result', () => {
    // 2a — DISCRIMINATOR
    it('halts when the !-inverted dependency is true', () => {
      let afterRan = false
      const sp = superpipe({ isBlocked: () => true })
      const run = sp('not-true')
        .input(['user'])
        .pipe('!isBlocked', 'user') // !true === false → must halt
        .pipe(() => {
          afterRan = true
        }) // sentinel — must NOT run
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(false)
    })

    // 2b — control (passes on both)
    it('continues when the !-inverted dependency is false', () => {
      let afterRan = false
      const sp = superpipe({ isBlocked: () => false })
      const run = sp('not-false')
        .input(['user'])
        .pipe('!isBlocked', 'user') // !false === true → must continue
        .pipe(() => {
          afterRan = true
        }) // sentinel — must run
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(true)
    })
  })

  // --- 3. `?` prefix marks a pipe optional (DISCRIMINATOR) ---
  describe('? optional-pipes — prefix marks a pipe optional', () => {
    it('skips a ?-prefixed pipe when the dependency is undefined', () => {
      let afterRan = false
      const sp = superpipe({}) // no `maybeHandler` dependency provided
      const run = sp('optional-prefix')
        .input(['user'])
        .pipe('?maybeHandler', 'maybeValue') // dep + input both undefined → must skip
        .pipe(() => {
          afterRan = true
        }) // sentinel — MUST run
        .end()

      expect(() => run({ user: 'x' })).to.not.throw()
      expect(afterRan).to.equal(true)
    })
  })

  // --- 4. single positional scalar arg maps to its input name (DISCRIMINATOR) ---
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

  // --- 5. raw boolean dependency (flow control) ---
  describe('raw boolean dependency — used as flow control', () => {
    it('continues when a raw boolean dependency is true', () => {
      let afterRan = false
      const sp = superpipe({ isBlocked: true }) // raw boolean, not a function
      const run = sp('bool-true')
        .input(['user'])
        .pipe('isBlocked', 'user') // true → must continue
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
        .pipe('isBlocked', 'user') // false → must halt
        .pipe(() => {
          afterRan = true
        }) // sentinel — must NOT run
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(false)
    })

    it('inverts a raw boolean dependency with ! (halts when true)', () => {
      let afterRan = false
      const sp = superpipe({ isBlocked: true })
      const run = sp('bool-not')
        .input(['user'])
        .pipe('!isBlocked', 'user') // !true === false → must halt
        .pipe(() => {
          afterRan = true
        }) // sentinel — must NOT run
        .end()

      run({ role: 'admin' })
      expect(afterRan).to.equal(false)
    })
  })
})

// --- review round 2: parity behaviors pinned from the codex findings ---
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
      .pipe('enabled') // runtime false must halt, not fall back to the dep
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

// --- review round 3: parity behaviors pinned from the second codex round ---
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

  it('merges a plain-object return into the store when no output is declared', () => {
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
    expect(observed).to.deep.equal(['alice', 'admin'])
  })

  it('rethrows the original falsy thrown value as an error, not success', () => {
    let afterRan = false
    const sp = superpipe({})
    const run = sp('falsy-throw')
      .pipe(() => {
        // Intentional falsy throw — pins the contract that falsy thrown
        // values are treated as errors, not as successful completion.
        throw null
      })
      .pipe(() => {
        afterRan = true
      })
      .end()

    expect(() => run()).to.throw()
    expect(afterRan).to.equal(false)
  })

  it('stores nothing when multiple outputs receive a primitive return value', () =>
    new Promise((done) => {
      // Master maps only arrays (positionally) and objects (by property);
      // a primitive with multiple output names maps to nothing.
      const sp = superpipe({})
      const run = sp('primitive-multi-output')
        .pipe(() => 'ab', null, ['x', 'y'])
        .pipe(
          (x, y) => {
            expect(x).to.equal(undefined)
            expect(y).to.equal(undefined)
            done()
          },
          ['x', 'y'],
        )
        .end()

      expect(() => run()).to.not.throw()
    }))

  it('rejects empty input declarations at construction', () => {
    const sp = superpipe({})
    expect(() => sp('bad-input').input([])).to.throw('Input pipe requires a non-empty string')
    expect(() => sp('bad-input2').input('')).to.throw('Input pipe requires a non-empty string')
  })
})

// --- review round 4: behaviors pinned from the third codex round ---
describe('review-fix contract (round 3 parity behaviors)', () => {
  it('selects the declared property for a single output over an object return', () => {
    let observed
    const sp = superpipe({})
    const run = sp('object-single-output')
      .pipe(() => ({ arg2: 'value', other: 1 }), null, 'arg2')
      .pipe((arg2) => {
        observed = arg2
      }, 'arg2')
      .end()

    run()
    expect(observed).to.equal('value')
  })

  it('maps arrays positionally even with a single output name', () => {
    let observed
    const sp = superpipe({})
    const run = sp('array-single-output')
      .pipe(() => ['a', 'b'], null, 'first')
      .pipe((first) => {
        observed = first
      }, 'first')
      .end()

    run()
    expect(observed).to.equal('a')
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

// --- review round 5: behaviors pinned from the fourth codex round ---
describe('review-fix contract (round 4 parity behaviors)', () => {
  it('processes tuples that follow an explicit end tuple', () =>
    new Promise((done) => {
      const sp = superpipe({ tag: (s) => `tagged:${s}` })
      const run = sp('end-then-more', [
        ['input', ['x']],
        ['end'], // explicit end, then more tuples
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

// --- review round 6: behaviors pinned from the fifth codex round ---
describe('review-fix contract (round 5 parity behaviors)', () => {
  it('sees dependency updates made after the executor was built', () => {
    const deps = { enabled: false }
    const sp = superpipe(deps)
    let afterRan = false
    const run = sp('live-deps')
      .pipe('enabled') // falsey raw boolean → halts
      .pipe(() => {
        afterRan = true
      })
      .end()

    run()
    expect(afterRan).to.equal(false)

    deps.enabled = true // mutate the configured container
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
      .pipe('?handler', '{user, config}') // config is undefined
      .pipe(() => {
        afterRan = true
      })
      .end()

    expect(() => run({ user: 'x' })).to.not.throw()
    expect(afterRan).to.equal(true)
  })

  it('accumulates multiple input declarations', () =>
    new Promise((done) => {
      // Each declaration maps the same invocation arguments positionally;
      // what matters is that an earlier declaration is not lost.
      const sp = superpipe({})
      const run = sp('multi-input')
        .input(['arg1'])
        .pipe('input', ['arg2']) // restored reserved form as a second declaration
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

// --- review round 7: behaviors pinned from the sixth codex round ---
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

// --- review round 8: behaviors pinned from the seventh codex round ---
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

  it('treats object-string outputs as property selection over any return', () => {
    let observed = 'unset'
    const sp = superpipe({})
    const run = sp('objstring-scalar')
      .pipe(() => 'scalar', null, '{a}')
      .pipe((a) => {
        observed = a
      }, 'a')
      .end()

    run()
    expect(observed).to.equal(undefined)
  })
})

// --- error channel contract: active error lives on execution state (#39) ---
describe('error channel contract (state-based error)', () => {
  it('treats an error property merged from a pipe result as data', () =>
    new Promise((done) => {
      const failure = new Error('from-result')
      const sp = superpipe({})
      const run = sp('error-in-result')
        .pipe(() => ({ error: failure }), null, '{error}')
        .pipe((error) => {
          // The pipeline continues past the data named `error`; it is an
          // ordinary input here, not a failure signal.
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

// --- output namespace contract: reserved names and shadowing (#40) ---
describe('output namespace contract (reserved names and shadowing)', () => {
  it('throws when a declared output writes the reserved name next', () => {
    const sp = superpipe({})
    const run = sp('reserved-output')
      .pipe(() => 'x', null, 'next')
      .end()

    expect(() => run()).to.throw('Output name "next" is reserved')
  })

  it('throws when an undeclared plain-object return contains next', () => {
    const sp = superpipe({})
    const run = sp('reserved-undeclared')
      .pipe(() => ({ a: 1, next: () => {} }))
      .end()

    expect(() => run()).to.throw('Output name "next" is reserved')
  })

  it('throws when an output rename maps onto next', () => {
    const sp = superpipe({})
    const run = sp('reserved-rename')
      .pipe(() => 'x', null, ['a:next'])
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
    // Invocation inputs are the caller's per-run values — overriding a
    // configured dependency here is deliberate (the runtime-false parity
    // behavior), unlike mid-flight output shadowing.
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

// --- review round: namespace errors surface regardless of delivery path ---
describe('output namespace contract (delivery parity)', () => {
  it('surfaces a namespace error raised through a synchronous next, not the error handler', () => {
    const sp = superpipe({ shared: (v) => v })
    let handlerCalled = false
    const run = sp('sync-next-namespace')
      .pipe(
        (next) => {
          next(null, 'value') // merge happens inside fn.apply's try block
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
    // Object.prototype built-ins are not user-configured dependencies;
    // a data output named like one must not trip the shadow guard.
    const sp = superpipe({})
    const run = sp('proto-ok')
      .pipe(() => 'value', null, 'toString')
      .end()

    expect(() => run()).to.not.throw()
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

  it('halts when a promise resolves to false (sync/async parity)', () => {
    let afterRan = false
    const sp = superpipe({})
    const run = sp('promise-false')
      .pipe(() => Promise.resolve(false))
      .pipe(() => {
        afterRan = true
      })
      .end()

    run()
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(afterRan).to.equal(false)
        resolve()
      }, 20)
    })
  })

  it('keeps fully synchronous pipelines synchronous', () => {
    const sp = superpipe({})
    const run = sp('sync-still')
      .pipe(() => 'v', null, 'out')
      .end('out')
    // .end(output) returns populated data synchronously for sync pipelines.
    expect(run()).to.equal('v')
  })
})

// --- review round: thenable edge cases ---
describe('promise continuation contract (thenable edge cases)', () => {
  it('inverts a !-pipe whose async dependency resolves true (halts)', () => {
    let afterRan = false
    const sp = superpipe({ isBlocked: async () => true })
    const run = sp('not-async-true')
      .input(['user'])
      .pipe('!isBlocked', 'user') // resolves true → \!true === false → must halt
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
        .pipe('!isBlocked', 'user') // resolves false → \!false === true → must continue
        .pipe(() => {
          done()
        })
        .end()

      run({ role: 'admin' })
    }))

  it('adopts callable thenables (functions with a then method)', () =>
    new Promise((done) => {
      const callableThenable = Object.assign(() => {}, {
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
        next() // advances into the next pipe inside this fn.apply
      }, 'next')
      .pipe((_next) => Promise.resolve('x'), 'next') // ambiguous continuation
      .error(() => {
        handlerCalled = true
      })
      .end()

    expect(() => run()).to.throw('one continuation channel')
    expect(handlerCalled).to.equal(false)
  })
})

// --- review round 2: guarded assimilation and ambiguity invalidation ---
describe('promise continuation contract (guarded assimilation)', () => {
  it('routes a throwing then accessor to the error handler', () =>
    new Promise((done) => {
      const throwingAccessor = {
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
    // The ambiguity error must surface without leaving the returned
    // rejection unhandled behind it.
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

// --- review round 3: next buffering and invalidation ---
describe('promise continuation contract (next buffering)', () => {
  it('does not advance when a pipe calls next and returns a thenable', async () => {
    let advanced = false
    const sp = superpipe({})
    const run = sp('sync-next-thenable')
      .pipe((next) => {
        next() // synchronous call, held until the return channel is known
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
          // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
    // A disabled callback discards the late call instead of throwing from
    // an unrelated callback stack.
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

// --- review round 4: invocation-local callback state ---
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
            run(1) // nested synchronous invocation of the same executor
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
    // Both the nested and the outer invocation must reach the downstream
    // pipe — a shared per-fetcher buffer would stall the outer one.
    expect(downstreamRuns).to.equal(2)
  })
})

// --- review round 5: reentrancy inside dependency lookup ---
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
            run() // synchronous re-entry during dependency lookup
          } catch {
            // the nested invocation's own ambiguity surfaces here
          }
        }
        return 'value'
      },
    })
    run = sp('getter-reentrancy')
      .pipe(
        (_dep, next) => {
          next()
          return Promise.resolve('x') // ambiguous — must throw before advancing
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

// --- review round 6: promise-job adoption and call-order flushing ---
describe('promise continuation contract (adoption timing and flush order)', () => {
  it('invokes a custom then method in a later promise job', () =>
    new Promise((done) => {
      let afterRun = false
      let observedInThen
      const sp = superpipe({})
      const run = sp('deferred-then')
        .pipe(
          () => ({
            // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
      afterRun = true // the then method must observe post-run state
    }))

  it('flushes buffered next calls in invocation order, not declaration order', () =>
    new Promise((done) => {
      let observed
      const sp = superpipe({})
      const run = sp('flush-order')
        .pipe(
          (first, second) => {
            second(null, 'first-invoked') // invoked first, declared second
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

// --- review round 7: nested assimilation and intrinsic invocation ---
describe('promise continuation contract (cleanup assimilation)', () => {
  it('consumes a nested rejected promise resolved during ambiguity cleanup', () => {
    const sp = superpipe({})
    const run = sp('nested-reject-ambiguity')
      .pipe(
        (_next) => ({
          // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
          then(resolve) {
            resolve(Promise.reject(new Error('nested')))
          },
        }),
        'next',
      )
      .end()

    expect(() => run()).to.throw('one continuation channel')
    // An unhandled rejection would fail the test run once microtasks drain.
    return new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('invokes a then method whose call property is shadowed', () =>
    new Promise((done) => {
      const then = Object.assign((resolve) => resolve('ok'), { call: null })
      const sp = superpipe({})
      const run = sp('shadowed-call')
        .pipe(
          () => ({
            // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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

// --- review round 8: failure timing and disabled-callback semantics ---
describe('promise continuation contract (failure timing and discards)', () => {
  it('defers a then accessor failure to the rejection path', () => {
    let handlerObservedAfterRun
    let afterRun = false
    const sp = superpipe({})
    const run = sp('accessor-timing')
      .pipe(
        () => ({
          // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
        // Same timing as a throwing then method: the handler runs in a
        // microtask after the caller's synchronous initialization.
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
        setTimeout(next, 5) // scheduled outside the returned thenable
        return Promise.resolve('x')
      }, 'next')
      .pipe(() => {
        advanced = true
      })
      .end()

    expect(() => run()).to.throw('one continuation channel')
    // The timer firing must not crash the process nor advance the pipeline.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(advanced).to.equal(false)
  })
})

// --- review round 9: guard ordering and native-promise adoption ---
describe('promise continuation contract (guard order and native adoption)', () => {
  it('discards a repeat call on a disabled callback before the duplicate check', async () => {
    let advanced = false
    let retained
    const sp = superpipe({})
    const run = sp('disabled-before-called')
      .pipe((next) => {
        retained = next
        next() // first call — held, then discarded by invalidation
        return Promise.resolve('x')
      }, 'next')
      .pipe(() => {
        advanced = true
      })
      .end()

    expect(() => run()).to.throw('one continuation channel')
    await new Promise((resolve) => setTimeout(resolve, 10))
    // The invalidation guard runs first: no NextCalledTwiceError, no crash.
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
        // The pipeline's reaction was attached directly to the native
        // promise, so it runs before a caller microtask queued after run().
        expect(order).to.deep.equal(['pipeline', 'caller-microtask'])
        done()
      })
    }))
})

// --- review round 10: guarded native-promise adoption ---
describe('promise continuation contract (native subclass adoption)', () => {
  it('routes a throwing then override on a native promise subclass to the error handler', () =>
    new Promise((done) => {
      class ThrowingThen extends Promise {
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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

// --- review round 11: hostile native-promise overrides ---
describe('promise continuation contract (hostile overrides)', () => {
  it('ignores repeated settlements from a hostile then override', () => {
    let handlerRuns = 0
    let downstreamRuns = 0
    class Hostile extends Promise {
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
      then(onFulfilled, onRejected) {
        if (onFulfilled) {
          onFulfilled('first')
          // The second settlement must be ignored — without a once-settled
          // guard this would run the error handler after the pipeline
          // already completed.
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
        expect(downstreamRuns).to.equal(2) // both downstream pipes ran once
        expect(handlerRuns).to.equal(0) // the second settlement was ignored
        resolve()
      }, 10)
    })
  })

  it('consumes a rejected native subclass whose then override throws in cleanup', () => {
    class RejectedThrowing extends Promise {
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
      then() {
        throw new Error('override threw')
      }
    }
    const sp = superpipe({})
    const run = sp('cleanup-rejection')
      .pipe(() => new RejectedThrowing((_resolve, reject) => reject(new Error('original'))), 'next')
      .end()

    expect(() => run()).to.throw('one continuation channel')
    // The original rejection must be observed through the intrinsic then;
    // an unhandled rejection would fail the run once microtasks drain.
    return new Promise((resolve) => setTimeout(resolve, 20))
  })
})

// --- review round 12: proxy traps and deferred override adoption ---
describe('promise continuation contract (proxies and deferred overrides)', () => {
  it('adopts a proxied thenable whose prototype trap throws', () =>
    new Promise((done) => {
      const target = {
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
          // The downstream pipe runs after the caller's initialization,
          // like every other thenable adoption.
          expect(afterRun).to.equal(true)
          done()
        }, 'out')
        .end()

      run()
      afterRun = true
    }))
})

// --- review round 13: hostile-settlement edge cases and release-on-disable ---
describe('promise continuation contract (settlement edge cases)', () => {
  it('ignores an override throw after fulfillment', () => {
    let handlerRuns = 0
    class SettleThenThrow extends Promise {
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
        // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
