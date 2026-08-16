/**
 * Flow-control contract tests.
 *
 * These pin three README-documented behaviors and use only the public API,
 * so the file runs unchanged on any branch:
 *
 *   1. Boolean flow control — `false` steers the pipeline only on the
 *      declarative channels (raw boolean dependencies, `!`-pipes); a
 *      function pipe's `false` return is ordinary data.
 *   2. `!` not-pipes — prefixing an injected name with `!` inverts its boolean
 *      result (observed via flow control: `!isBlocked` continues only when
 *      isBlocked is falsey, halts when truthy).
 *   3. `?` optional-pipes — prefixing an injected name with `?` skips the pipe
 *      when the dependency (or its input) is undefined, instead of throwing.
 */
import { describe, expect, it } from 'vitest'
import superpipe, { PipelineAbortedError } from '../src'

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

  // --- 1. function returns are data; false no longer halts (DISCRIMINATOR) ---
  describe('boolean returns — a function pipe returning false is data', () => {
    it('stores a returned false under the output name and continues', () => {
      let observed = 'unset'
      const sp = superpipe({})
      const run = sp('false-data')
        .pipe(() => false, null, 'flag') // data return, not flow control
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
        .pipe('check', 'user', 'ok') // injected fn return, no ! → data
        .pipe((ok) => {
          observed = ok
        }, 'ok')
        .end()

      run('x')
      expect(observed).to.equal(false)
    })

    it('halts only on the declarative channels: boolean deps and !-pipes', () => {
      // Raw boolean dependency false → halt (kept from the README contract).
      let afterRan = false
      const sp = superpipe({ isBlocked: false })
      const run = sp('bool-dep-halt')
        .input(['user'])
        .pipe('isBlocked', 'user') // raw boolean dependency → flow control
        .pipe(() => {
          afterRan = true
        }) // sentinel — must NOT run
        .end()

      run({ role: 'admin' })
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
        // Same behavior as a synchronous `return false`: stored as data,
        // pipeline continues.
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

// --- review round 14: opaque rejection reasons and getter-throw observation ---
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
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
    // The rejection reason is opaque: observing the rejection must not
    // assimilate (and thereby invoke) the then-looking reason.
    expect(reasonThenCalls).to.equal(0)
  })
})

// --- review round 15: verified observation and terminal-error discards ---
describe('promise continuation contract (verified observation)', () => {
  it('consumes the captured thenable when the brand check false-positives', () => {
    // Object.create(Promise.prototype) passes instanceof Promise but has no
    // internal slots; the intrinsic then cannot run on it.
    let consumed = false
    const slotless = Object.create(Promise.prototype)
    // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
      // biome-ignore lint/suspicious/noThenProperty: intentional thenable under test
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
        next() // advance synchronously; the downstream pipe starts a promise
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
    // The late resolution must not merge into or re-run the failed execution.
    expect(handlerRuns).to.equal(1)
  })
})

// --- endAsync contract: promise-returning .end (#48) ---
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

    // The failure becomes a rejection, never a sync throw out of run().
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
      .pipe('isBlocked', 'user') // raw boolean dep false → halt
      .pipe(() => 'never', null, 'never')
      .endAsync('kept')

    await expect(run()).resolves.toEqual('kept-value')
  })

  it('rejects once when a pending continuation races an error', async () => {
    let rejections = 0
    const sp = superpipe({})
    const run = sp('endasync-error-wins')
      .pipe((next) => {
        next() // advance; the downstream pipe starts a pending promise
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

    // Settled before the handler ran, so the promise still rejects with
    // the original error rather than hanging.
    await expect(run()).rejects.toThrow('original')
  })
})

// --- review round 1 on endAsync: async halts, async exceptions, error priority ---
describe('endAsync contract (settlement edge cases)', () => {
  it('settles a promise-based flow-control halt', async () => {
    const sp = superpipe({ isBlocked: async () => true })
    const run = sp('endasync-promise-halt')
      .input(['user'])
      .pipe('!isBlocked', 'user') // resolves true → inverted → halt
      .pipe(() => 'never', null, 'never')
      .endAsync('out')

    // Halted: resolves with the partial snapshot — 'out' was never produced.
    await expect(run()).resolves.toEqual(undefined)
  })

  it('rejects when an async continuation raises a namespace error', async () => {
    const sp = superpipe({})
    const run = sp('endasync-async-namespace')
      // Undeclared object return merges a reserved name from a microtask.
      .pipe(() => Promise.resolve({ next: () => {} }), null)
      .endAsync('out')

    await expect(run()).rejects.toThrow('reserved')
  })

  it('rejects when an error wins after a synchronous flush completes the run', async () => {
    const sp = superpipe({})
    const run = sp('endasync-flush-error')
      .pipe((next) => {
        next() // held; downstream completes synchronously on flush
        throw new Error('pipe error')
      }, 'next')
      .pipe(() => 'done', null, 'out')
      .error(() => {}, 'error')
      .endAsync('out')

    await expect(run()).rejects.toThrow('pipe error')
  })
})

// --- review round 2 on endAsync: foreign-stack exceptions and fetch failures ---
describe('endAsync contract (foreign-stack exceptions)', () => {
  it('rejects when a retained next raises from a foreign callback stack', async () => {
    const sp = superpipe({})
    const run = sp('endasync-late-next-throw')
      .pipe((next) => {
        // The reserved-name merge throws after runPipeline returned, on
        // the timer's stack.
        setTimeout(() => next(null, { next: () => {} }), 5)
      }, 'next')
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
      .endAsync('out') // 'out' falls back to the configured getter

    await expect(run()).rejects.toThrow('getter threw')
  })

  it('surfaces async failures as unhandled rejections for sync .end() runs', async () => {
    const seen = []
    const onUnhandled = (err) => seen.push(err)
    process.on('unhandledRejection', onUnhandled)
    const sp = superpipe({})
    const run = sp('end-async-unhandled')
      .pipe(() => Promise.reject(new Error('boom'))) // no handler, no observer
      .end()

    run()
    await new Promise((resolve) => setTimeout(resolve, 20))
    process.off('unhandledRejection', onUnhandled)
    // Preserved pre-endAsync behavior: the failure surfaces on the
    // reaction stack instead of being swallowed.
    expect(seen.length).to.equal(1)
    expect(seen[0].message).to.equal('boom')
  })
})

// --- review round 3 on endAsync: in-flight continuations ---
describe('endAsync contract (in-flight continuations)', () => {
  it('waits for an in-flight continuation before settling and merges through its own pipe', async () => {
    let resolveAsync
    let settledEarly = false
    const sp = superpipe({})
    const run = sp('endasync-inflight')
      .pipe(
        (first, second) => {
          first() // starts the pending promise pipe below
          second() // advances past it while it is in flight
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
    // Still waiting: the second next advanced past the pending pipe, but
    // the run cannot complete while its promise is in flight.
    expect(settledEarly).to.equal(false)

    resolveAsync('late-value')
    // The late value merges through its own pipe's producer, not the
    // final pipe's.
    await expect(outcome).resolves.toEqual({ late: 'late-value', out: 'done' })
  })
})

// --- review round 4 on endAsync: slot, sibling halts, terminal exceptions ---
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
    expect(observedOut).to.equal(undefined) // no fabricated out: 0
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
      .pipe('!allow', 'user') // resolves true → inverted → async halt
      .endAsync('{late}')

    const outcome = run({ role: 'admin' })
    outcome.then(() => {
      settledEarly = true
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    // The guard halted, but the value pipe is still in flight.
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
          retained = second // the sibling stays live past the exception
        },
        ['next', 'next'],
      )
      // Resolves with a reserved name — its merge raises OutputNameError.
      .pipe(() => Promise.resolve({ next: () => {} }), null)
      .pipe(() => {
        sideEffect = true
      })
      .endAsync('out')

    const outcome = run()
    // Attach the handler immediately so the eventual rejection is never
    // unhandled while the test waits out the timers.
    const assertion = expect(outcome).rejects.toThrow('reserved')
    await new Promise((resolve) => setTimeout(resolve, 10)) // exception lands
    // The late sibling would also violate the namespace — it must be
    // discarded, not merged or executed.
    retained(null, { next: () => {} })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await assertion
    // The sibling continuation is discarded: no post-rejection execution.
    expect(sideEffect).to.equal(false)
  })
})

// --- review round 5 on endAsync: halt preserved across siblings ---
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
      .pipe('!allow', 'user') // async halt: resolves true, inverted to false
      .pipe(() => {
        sideEffect = true
      }, 'late') // after the guard — must never run
      .endAsync('{late}')

    const outcome = run({ role: 'admin' })
    await new Promise((resolve) => setTimeout(resolve, 10)) // guard halted
    resolveSlow('late-value')
    const result = await outcome
    // The sibling merged its own output, but nothing after the halt ran.
    expect(result.late).to.equal('late-value')
    expect(sideEffect).to.equal(false)
  })
})

// --- review round 6 on endAsync: retained next callbacks ---
describe('endAsync contract (retained continuations)', () => {
  it('waits for a retained next callback before resolving', async () => {
    let settledEarly = false
    let retained
    const sp = superpipe({})
    const run = sp('endasync-retained-next')
      .pipe(
        (first, second) => {
          first() // drives the pipeline onward
          retained = second // still live, fired later from a timer
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
    // The retained callback is a live continuation — the run stays open.
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

// --- review round 7 on endAsync: skipped optionals, post-error discards, fromStep ---
describe('endAsync contract (wrapper lifecycle)', () => {
  it('settles when an optional pipe declaring next is skipped', async () => {
    const sp = superpipe({})
    const run = sp('endasync-optional-next')
      .input(['user'])
      .pipe('?missing', ['next', 'missingValue'], 'out') // skipped: dep missing
      .pipe(() => 'done', null, 'done')
      .endAsync('done')

    // Without wrapper invalidation the skipped pipe's counted callback
    // holds the run open forever.
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
    // Would raise OutputNameError on the test's stack if late callbacks
    // still entered the pipeline after the terminal error.
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
          retained = second // fires later; its value belongs to this pipe
          first() // advance now
        },
        ['next', 'next'],
        'firstValue',
      )
      .pipe(() => 'second-value', null, 'secondValue')
      .endAsync('{firstValue, secondValue}')

    const outcome = run()
    await new Promise((resolve) => setTimeout(resolve, 10))
    retained(null, 'the-first-value')
    // The late value merges through the first pipe's producer, not the
    // last pipe's.
    await expect(outcome).resolves.toEqual({
      firstValue: 'the-first-value',
      secondValue: 'second-value',
    })
  })
})

// --- review round 8 on endAsync: handler throws from late callbacks, held fromStep ---
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
    // The run already rejected with the original error; the handler's own
    // throw must not escape onto the timer stack.
    expect(seen).to.deep.equal([])
  })

  it('binds held next values to their originating pipe', async () => {
    const sp = superpipe({})
    const run = sp('endasync-held-fromstep')
      .pipe(
        (first, second) => {
          first(null, 'first-value')
          second(null, 'second-value') // both held; both belong to this pipe
        },
        ['next', 'next'],
        'value',
      )
      .pipe((v) => 'next:' + v, 'value', 'downstream')
      .endAsync('{value, downstream}')

    const result = await run()
    // The second held value merges through the first pipe's producer.
    expect(result).toEqual({ value: 'second-value', downstream: 'next:first-value' })
  })
})

// --- review round 9 on endAsync: downstream deferral ---
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
    // The consumer pipe waits for the promise pipe's output — it must not
    // run early with undefined inputs.
    resolveA('a-value')
    await expect(outcome).resolves.toEqual({ first: 'a-value', second: undefined })
  })
})

// --- review round 10 on endAsync: duplicate late callbacks ---
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
    retained() // advances the run to completion
    retained() // duplicate: rejected, not thrown onto the caller stack
    await assertion
  })
})

// --- review round 11 on endAsync: boolean deps with a next input ---
describe('endAsync contract (boolean dependencies)', () => {
  it('evaluates a raw boolean dependency normally despite a next input', async () => {
    const sp = superpipe({ enabled: true })
    const run = sp('endasync-bool-with-next')
      .input(['user'])
      .pipe('enabled', 'next') // degenerate declaration — boolean cannot call next
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

// --- review round 12 on endAsync: object-form duplicate next keys ---
describe('endAsync contract (object-form next keys)', () => {
  it('deduplicates a repeated next key in object-string inputs', async () => {
    const sp = superpipe({})
    const run = sp('endasync-objstring-dup')
      .pipe(({ next }) => {
        next()
      }, '{next, next}')
      .pipe(() => 'done', null, 'done')
      .endAsync('done')

    // One wrapper exposed and counted — invoking it settles the run.
    await expect(run()).resolves.toEqual('done')
  })
})

// --- endAsync abort contract: AbortSignal cancellation (#50) ---
describe('endAsync abort contract', () => {
  it('rejects with PipelineAbortedError when the signal aborts mid-run', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-mid-run')
      .pipe(() => new Promise(() => {}), null, 'never')
      .endAsync('out', { signal: controller.signal })

    const promise = run()
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)
  })

  it('carries the AbortError name and preserves the signal reason', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-reason')
      .pipe(() => new Promise(() => {}), null, 'never')
      .endAsync('out', { signal: controller.signal })

    const promise = run()
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
      .endAsync('out', { signal: controller.signal })

    const promise = run()
    controller.abort()
    await promise.catch(() => {})
    expect(handlerRuns).to.equal(0)
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
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
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
      .endAsync('out', { signal: controller.signal })

    const promise = run()
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(resolved).to.equal(false)
  })

  it('abort wins over a later promise rejection', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-vs-reject')
      .pipe(
        () =>
          new Promise((_resolve, reject) => {
            setTimeout(() => reject(new Error('late rejection')), 5)
          }),
        null,
        'out',
      )
      .endAsync('out', { signal: controller.signal })

    const promise = run()
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)
    // Let the pending rejection land — the discarded continuation must not
    // re-reject or surface as an unhandled rejection.
    await new Promise((resolve) => setTimeout(resolve, 20))
  })

  it('disables a retained next so a late callback is a no-op', async () => {
    let lateRan = false
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-retained-next')
      .pipe(
        (next) => {
          setTimeout(() => next(null, 'late'), 5)
        },
        'next',
        'out',
      )
      .pipe(() => {
        lateRan = true
      }, 'out')
      .endAsync('out', { signal: controller.signal })

    const promise = run()
    controller.abort()
    await promise.catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(lateRan).to.equal(false)
  })

  it('ignores an abort after the run already completed', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-after-complete')
      .pipe(() => 'done', null, 'out')
      .endAsync('out', { signal: controller.signal })

    const result = await run()
    controller.abort()
    expect(result).to.equal('done')
  })

  it('leaves endAsync unchanged when no signal is supplied', async () => {
    const sp = superpipe({})
    const run = sp('abort-no-signal')
      .pipe(() => 'v', null, 'out')
      .endAsync('out')

    await expect(run()).resolves.toEqual('v')
  })

  it('does not touch the synchronous .end path', () => {
    let ran = false
    const sp = superpipe({})
    const run = sp('abort-sync-end')
      .pipe(
        () => {
          ran = true
          return 'v'
        },
        null,
        'out',
      )
      .end('out')

    expect(run()).to.equal('v')
    expect(ran).to.equal(true)
  })
})

// --- endAsync abort contract: review round 1 (#50) ---
describe('endAsync abort contract (review round 1)', () => {
  it('does not execute a pipe after an abort during dependency resolution', async () => {
    const controller = new AbortController()
    let pipeRan = false
    const sp = superpipe({
      get dep() {
        controller.abort()
        return () => 'value'
      },
    })
    const run = sp('abort-during-resolve')
      .pipe('dep', null, 'out') // resolving the injected `dep` aborts the run
      .pipe(() => {
        pipeRan = true
      }, 'out')
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(pipeRan).to.equal(false)
  })

  it('does not execute a pipe after an abort during input resolution', async () => {
    const controller = new AbortController()
    let pipeRan = false
    const sp = superpipe({
      makeFn: (x) => x,
      get inputDep() {
        controller.abort()
        return 'x'
      },
    })
    const run = sp('abort-during-fetch')
      .pipe('makeFn', 'inputDep', 'out') // fetching `inputDep` aborts the run
      .pipe(() => {
        pipeRan = true
      }, 'out')
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(pipeRan).to.equal(false)
  })

  it('still rejects with the namespace error when initialization throws with a signal', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-reserved-input')
      .input(['next']) // reserved name → OutputNameError during input mapping
      .pipe(() => 'x', null, 'out')
      .endAsync('out', { signal: controller.signal })

    // The reserved-name failure surfaces as a rejection (not a hang or an
    // abort) even though a signal was registered before the input mapping.
    await expect(run()).rejects.toThrow('reserved')
  })
})

// --- endAsync abort contract: review round 2 (#50) ---
describe('endAsync abort contract (review round 2)', () => {
  it('does not execute an optional pipe after an abort during optional probing', async () => {
    const controller = new AbortController()
    let reads = 0
    let pipeRan = false
    const sp = superpipe({
      dep: () => 'value',
      get inputDep() {
        reads += 1
        if (reads === 2) controller.abort() // second read is hasUnresolved's probe
        return 'x'
      },
    })
    const run = sp('abort-optional-probe')
      .pipe('?dep', 'inputDep', 'out') // optional: input `inputDep` is read twice
      .pipe(() => {
        pipeRan = true
      }, 'out')
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(pipeRan).to.equal(false)
  })

  it('does not rethrow an aborted continuation that also throws on a foreign stack', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-foreign-throw')
      .pipe(
        (next) => {
          setTimeout(() => {
            next(null, {
              get out() {
                controller.abort()
                throw new Error('getter boom')
              },
            })
          }, 5)
        },
        'next',
        'out',
      )
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    // Let the timer fire the throwing accessor — the discarded continuation
    // must not rethrow onto the timer stack (vitest would surface it).
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
})

// --- endAsync abort contract: review round 3 (#50) ---
describe('endAsync abort contract (review round 3)', () => {
  it('does not inspect a thenable returned after a synchronous abort', async () => {
    const controller = new AbortController()
    let thenRead = 0
    const sp = superpipe({})
    const run = sp('abort-thenable-result')
      .pipe(
        () => {
          controller.abort()
          return {
            // biome-ignore lint/suspicious/noThenProperty: deliberately returning a thenable
            get then() {
              thenRead += 1
              return () => {}
            },
          }
        },
        null,
        'out',
      )
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(thenRead).to.equal(0)
  })

  it('stops mapping invocation inputs after an accessor aborts', async () => {
    const controller = new AbortController()
    let secondRead = 0
    const sp = superpipe({})
    const run = sp('abort-input-mapping')
      .input('{first}')
      .input('{second}')
      .pipe(() => 'done', null, 'out')
      .endAsync('out', { signal: controller.signal })

    const arg = {
      get first() {
        controller.abort()
        return 'a'
      },
      get second() {
        secondRead += 1
        return 'b'
      },
    }

    await expect(run(arg)).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(secondRead).to.equal(0)
  })
})

// --- endAsync abort contract: review round 4 (#50) ---
describe('endAsync abort contract (review round 4)', () => {
  it('stops multi-key input lookup at the aborting key', async () => {
    const controller = new AbortController()
    let secondRead = 0
    const sp = superpipe({
      makeFn: (a) => a,
      get first() {
        controller.abort()
        return 'a'
      },
      get second() {
        secondRead += 1
        return 'b'
      },
    })
    const run = sp('abort-fetch-multikey')
      .pipe('makeFn', ['first', 'second'], 'out')
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(secondRead).to.equal(0)
  })

  it('stops multi-key invocation mapping at the aborting key', async () => {
    const controller = new AbortController()
    let secondRead = 0
    const sp = superpipe({})
    const run = sp('abort-input-multikey')
      .input('{first, second}')
      .pipe(() => 'done', null, 'out')
      .endAsync('out', { signal: controller.signal })

    const arg = {
      get first() {
        controller.abort()
        return 'a'
      },
      get second() {
        secondRead += 1
        return 'b'
      },
    }

    await expect(run(arg)).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(secondRead).to.equal(0)
  })

  it('does not invoke a custom thenable then after a post-return abort', async () => {
    const controller = new AbortController()
    let thenCalls = 0
    const sp = superpipe({})
    const run = sp('abort-deferred-thenable')
      .pipe(
        () => ({
          // biome-ignore lint/suspicious/noThenProperty: deliberately returning a thenable
          then(resolve) {
            thenCalls += 1
            resolve('adopted')
          },
        }),
        null,
        'out',
      )
      .endAsync('out', { signal: controller.signal })

    const promise = run()
    controller.abort()
    await promise.catch(() => {})
    // The deferred adoption job must see the nulled gate and skip `then`.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(thenCalls).to.equal(0)
  })

  it('stops output mapping at the aborting accessor', async () => {
    const controller = new AbortController()
    let secondRead = 0
    const sp = superpipe({})
    const run = sp('abort-output-mapping')
      .pipe(
        () => ({
          get first() {
            controller.abort()
            return 'a'
          },
          get second() {
            secondRead += 1
            return 'b'
          },
        }),
        null,
        ['first', 'second'],
      )
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(secondRead).to.equal(0)
  })

  it('keeps cancellation active while adopting a thenable output', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-output-thenable')
      .pipe(() => ({ out: new Promise(() => {}) }), null, 'out')
      .endAsync('out', { signal: controller.signal })

    const promise = run()
    // Let the run settle and the observer adopt the pending thenable output
    // (detaching the run's listener and installing the adoption race).
    await new Promise((resolve) => setTimeout(resolve, 0))
    controller.abort()
    await expect(promise).rejects.toBeInstanceOf(PipelineAbortedError)
  })
})

// --- endAsync abort contract: review round 5 (#50) ---
describe('endAsync abort contract (review round 5)', () => {
  it('rejects when an output accessor aborts and returns a thenable', async () => {
    const controller = new AbortController()
    const sp = superpipe({
      get out() {
        controller.abort()
        return new Promise(() => {})
      },
    })
    const run = sp('abort-output-accessor')
      .pipe(() => 'x', null, 'unused')
      .endAsync('out', { signal: controller.signal })

    // The output fetch aborts the signal, so the adoption race must observe
    // the already-aborted state and reject instead of hanging.
    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
  })

  it('reads a thenable output then getter only once', async () => {
    const controller = new AbortController()
    let reads = 0
    const thenable = {
      // biome-ignore lint/suspicious/noThenProperty: deliberately a thenable
      get then() {
        reads += 1
        if (reads === 1) return (resolve) => resolve('adopted-value')
        return undefined
      },
    }
    const sp = superpipe({})
    const run = sp('abort-thenable-once')
      .pipe(() => ({ out: thenable }), null, 'out')
      .endAsync('out', { signal: controller.signal })

    const result = await run()
    expect(result).to.equal('adopted-value')
    expect(reads).to.equal(1)
  })

  it('observes an overridden native promise rejection after an abort', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-overridden-native')
      .pipe(
        () => {
          const p = Promise.reject(new Error('late'))
          // biome-ignore lint/suspicious/noThenProperty: deliberately overriding then
          p.then = () => {}
          return p
        },
        null,
        'out',
      )
      .endAsync('out', { signal: controller.signal })

    const promise = run()
    controller.abort()
    await promise.catch(() => {})
    // The aborted adoption must still observe the branded promise's original
    // rejection so it is not reported unhandled when it lands.
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
})

// --- endAsync abort contract: review round 6 (#50) ---
describe('endAsync abort contract (review round 6)', () => {
  it('adopts a thenable output through a single then read without a signal', async () => {
    let reads = 0
    const thenable = {
      // biome-ignore lint/suspicious/noThenProperty: deliberately a thenable
      get then() {
        reads += 1
        if (reads === 1) return (resolve) => resolve('adopted')
        return undefined
      },
    }
    const sp = superpipe({})
    const run = sp('thenable-once-no-signal')
      .pipe(() => ({ out: thenable }), null, 'out')
      .endAsync('out')

    const result = await run()
    expect(result).to.equal('adopted')
    expect(reads).to.equal(1)
  })

  it('rejects when a thenable output aborts before it resolves synchronously', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('abort-thenable-sync')
      .pipe(
        () => ({
          out: {
            // biome-ignore lint/suspicious/noThenProperty: deliberately a thenable
            then(resolve) {
              controller.abort()
              resolve('value')
            },
          },
        }),
        null,
        'out',
      )
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
  })

  it('rejects when an output accessor aborts and returns a non-thenable', async () => {
    const controller = new AbortController()
    const sp = superpipe({
      get out() {
        controller.abort()
        return 'scalar'
      },
    })
    const run = sp('abort-output-scalar')
      .pipe(() => 'x', null, 'unused')
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
  })

  it('stops optional probing at the aborting input', async () => {
    const controller = new AbortController()
    let thirdRead = 0
    const sp = superpipe({
      dep: () => 'value',
      get a() {
        controller.abort()
        return 'x'
      },
      get b() {
        thirdRead += 1
        return 'y'
      },
    })
    const run = sp('abort-optional-probe-multi')
      .pipe('?dep', '{a, b}', 'out')
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(thirdRead).to.equal(0)
  })

  it('does not invoke a then after its getter aborts the run', async () => {
    const controller = new AbortController()
    let thenCalled = 0
    const sp = superpipe({})
    const run = sp('abort-then-getter')
      .pipe(
        (next) => ({
          // biome-ignore lint/suspicious/noThenProperty: deliberately a thenable
          get then() {
            controller.abort()
            return () => {
              thenCalled += 1
            }
          },
        }),
        'next',
        'out',
      )
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(thenCalled).to.equal(0)
  })
})

// --- endAsync abort contract: review round 7 (#50) ---
describe('endAsync abort contract (review round 7)', () => {
  it('resolves when a thenable output resolves before it aborts synchronously', async () => {
    const controller = new AbortController()
    const sp = superpipe({})
    const run = sp('resolve-then-abort')
      .pipe(
        () => ({
          out: {
            // biome-ignore lint/suspicious/noThenProperty: deliberately a thenable
            then(resolve) {
              resolve('value')
              controller.abort()
            },
          },
        }),
        null,
        'out',
      )
      .endAsync('out', { signal: controller.signal })

    // Resolution occurred before the abort, so it wins.
    await expect(run()).resolves.toEqual('value')
  })

  it('does not invoke a then when its getter aborts during output selection', async () => {
    const controller = new AbortController()
    let thenCalled = 0
    const thenable = {
      // biome-ignore lint/suspicious/noThenProperty: deliberately a thenable
      get then() {
        controller.abort()
        return () => {
          thenCalled += 1
        }
      },
    }
    const sp = superpipe({})
    const run = sp('abort-output-then-getter')
      .pipe(() => ({ out: thenable }), null, 'out')
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(thenCalled).to.equal(0)
  })
})

// --- endAsync abort contract: review round 8 (#50) ---
describe('endAsync abort contract (review round 8)', () => {
  it('rejects with the abort when an output accessor aborts and then throws', async () => {
    const controller = new AbortController()
    const sp = superpipe({
      get out() {
        controller.abort()
        throw new Error('accessor boom')
      },
    })
    const run = sp('abort-output-throw')
      .pipe(() => 'x', null, 'unused')
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
  })

  it('stops multi-key output selection at the aborting key', async () => {
    const controller = new AbortController()
    let secondRead = 0
    const sp = superpipe({
      get first() {
        controller.abort()
        return 'a'
      },
      get second() {
        secondRead += 1
        return 'b'
      },
    })
    const run = sp('abort-output-multikey')
      .pipe(() => 'x', null, 'unused')
      .endAsync(['first', 'second'], { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(secondRead).to.equal(0)
  })
})

// --- endAsync abort contract: review round 9 (#50) ---
describe('endAsync abort contract (review round 9)', () => {
  it('does not run a following pipe dependency getter after an output accessor aborts', async () => {
    const controller = new AbortController()
    let depRead = 0
    const sp = superpipe({
      get dep() {
        depRead += 1
        return () => 'x'
      },
    })
    const run = sp('abort-output-advance')
      .pipe(
        () => ({
          get out() {
            controller.abort()
            return 'a'
          },
        }),
        null,
        'out',
      )
      .pipe('dep', 'out', 'final')
      .endAsync('out', { signal: controller.signal })

    await expect(run()).rejects.toBeInstanceOf(PipelineAbortedError)
    expect(depRead).to.equal(0)
  })

  it('defers a custom thenable output invocation past an intervening microtask', async () => {
    const order = []
    const sp = superpipe({})
    const run = sp('deferred-thenable-order')
      .pipe(
        () => ({
          out: {
            // biome-ignore lint/suspicious/noThenProperty: deliberately a thenable
            then(resolve) {
              order.push('then')
              resolve('v')
            },
          },
        }),
        null,
        'out',
      )
      .endAsync('out')

    const promise = run()
    Promise.resolve().then(() => {
      order.push('user-microtask')
    })
    const result = await promise
    expect(result).to.equal('v')
    expect(order).to.deep.equal(['user-microtask', 'then'])
  })
})
