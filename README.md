# SuperPipe

[![CI status][ci-img]][ci-url]
[![Coverage][coverage-img]][coverage-url]
[![License MIT][license-img]][license-url]
[![JavaScript Style Guide][standard-img]][standard-url]
[![NPM version][npm-img]][npm-url]

A lightweight functional reactive programming (FRP) library for composing asynchronous operations with dependency injection.

## Installation

```sh
npm install superpipe
```

## Quick Start

```javascript
import superpipe from 'superpipe'

// Create a pipeline factory with dependencies
const sp = superpipe({
  greet: name => `Hello, ${name}!`
})

// Build a pipeline
const pipeline = sp('greeting-pipeline')
  .input(['name'])
  .pipe('greet', 'name', 'message')
  .pipe(message => console.log(message), 'message')
  .end()

// Execute the pipeline
pipeline('World')  // Output: Hello, World!
```

## Core Concepts

### Pipelines

A pipeline is a sequence of pipes that execute in order. Each pipe can:
- Transform data
- Produce outputs that become available to subsequent pipes
- Control flow through the declarative boolean channels (raw boolean
  dependencies, `!`-prefixed pipes)

### Pipes

Each pipe has three components:
- **Function**: The operation to perform (can be a function or a string referencing an injected dependency)
- **Input**: Dependencies the function needs (retrieved from the store or injected deps)
- **Output**: Names to assign to the return values

### Dependency Injection

Dependencies are passed when creating the superpipe factory and are available to all pipelines:

```javascript
const sp = superpipe({
  db: databaseConnection,
  logger: loggingService,
  config: appConfig
})
```

## API

### `superpipe(deps?)`

Creates a pipeline factory function.

- `deps` (optional): Object containing dependencies available to all pipelines

Returns a function `(name, defs?) => PipelineAPI | executor`

### Pipeline API

#### `.input(names)`

Maps positional arguments to named dependencies.

```javascript
sp('my-pipeline')
  .input(['userId', 'action'])  // First arg -> userId, second -> action
```

#### `.pipe(fn, input?, output?)`

Adds a pipe to the pipeline.

- `fn`: Function to execute, or string name of an injected dependency
- `input`: String or array of dependency names to pass as arguments
- `output`: String or array of names to assign to return values

```javascript
// Direct function
.pipe((a, b) => a + b, ['x', 'y'], 'sum')

// Injected function by name
.pipe('myFunction', ['arg1', 'arg2'], 'result')

// Using the special `next` input — next(error, value) assigns `value`
// to the pipe's declared output name
.pipe((next, value) => {
  setTimeout(() => next(null, value * 2), 100)
}, ['next', 'value'], 'key')
```

#### `.error(handler, input?)`

Sets an error handler for the pipeline. Only one error handler is allowed per pipeline.

```javascript
.error((error) => console.error('Pipeline error:', error), 'error')
```

#### `.end(output?)`

Finalizes the pipeline and returns an executor function. When `output` is
provided, the executor returns the requested output value (or an object of the
requested keys) once the pipeline completes; otherwise it returns `undefined`.

```javascript
const run = sp('my-pipeline')
  .input(['x'])
  .pipe(x => x * 2, 'x', 'doubled')
  .end('doubled')

run(5)  // Executes the pipeline with x=5, returns 10
```

### Declarative API

Pipelines can also be defined declaratively:

```javascript
const run = sp('math-pipeline', [
  ['input', ['a', 'b']],
  [(a, b) => a + b, ['a', 'b'], 'sum'],
  [(sum) => console.log('Sum:', sum), 'sum']
])

run(3, 4)  // Output: Sum: 7
```

## Special Features

### Special Input Dependencies

- `next`: Control when to proceed to the next pipe and assign outputs manually
  (for async operations)

```javascript
// Async operation — next(error, value) proceeds and stores `value`
// under the pipe's declared output name ('data')
.pipe((next, value) => {
  fetchData(value, (err, result) => {
    next(err, result)
  })
}, ['next', 'value'], 'data')
```

### Boolean Flow Control

`false` steers the pipeline only on the **declarative channels** — a raw
boolean dependency or a `!`-prefixed injected pipe. A function pipe's
return value, `false` included, is ordinary data: it is stored under the
output name and the pipeline continues.

```javascript
const sp = superpipe({ isBlocked: false })

// Raw boolean dependency — flow control: falsey halts
sp('guard')
  .pipe('isBlocked', 'user')  // Halts unless isBlocked is truthy
  .end()

// `!`-prefixed injected pipe — inverts the boolean for flow control
sp('not-blocked')
  .pipe('!isBlocked', 'user')  // Continues only while isBlocked is falsey
  .end()

// Function pipe — the boolean return is DATA, the pipeline continues
sp('admin-check')
  .pipe((user) => user.isAdmin, 'user', 'isAdmin')
  .end()
```

### Not Pipes (`!`)

Prefix function name with `!` to invert boolean results:

```javascript
.pipe('!isBlocked', 'user')  // Continues if isBlocked returns false
```

### Optional Pipes (`?`)

Prefix function name with `?` to skip if the dependency is undefined:

```javascript
.pipe('?optionalHandler', 'maybeValue')  // Skips if optionalHandler or maybeValue is undefined
```

### Output Renaming (`source:destination`)

Rename an output as it is stored, using `source:destination` syntax:

```javascript
.pipe(getData, 'id', 'result:userProfile')  // Stores the returned `result` as `userProfile`
```

### Reserved Output Names and Shadowing

The runtime container reserves `next` as a control name. A pipe output —
declared, renamed, or merged from a returned plain object — or an invocation
input that writes a reserved name throws. A pipe output whose name matches a
configured dependency also throws, since it would silently shadow it:

```javascript
superpipe({ shared: fn })
// throws on execution:
.pipe(() => 'value', null, 'shared')
```

Invocation inputs are the exception: a caller may deliberately override a
configured dependency by passing a per-run value under the same name.

### Asynchronous Pipelines and `.end(output)`

A pipe that does not request `next` may return a Promise (or any thenable):
resolution continues the pipeline with the value, rejection triggers the error
handler. Returning a thenable from a pipe that declares `next` throws — pick
one continuation channel.

```javascript
sp('async-pipeline')
  .pipe(() => repository.getWorkflow(), null, 'workflow')  // Promise-returning
  .pipe((workflow) => render(workflow), 'workflow')
  .error((error) => console.error('Failed:', error.message), 'error')
  .end()
```

The executor returned by `.end()` completes synchronously. When a pipe uses
`next` or returns a Promise, values produced later are not reflected in
`.end(output)`'s return value — use `.endAsync(output)` for that:

```javascript
const run = sp('fetch-workflow')
  .pipe(() => repository.getWorkflow(), null, 'workflow')
  .error((error) => console.error('Failed:', error.message), 'error')
  .endAsync('workflow')

const workflow = await run()   // Promise — settles when the run settles
```

`.endAsync` settles when the *run* settles — every pipe executed, a
flow-control halt fired, or an error was dispatched. A halted run resolves
with the partial snapshot; a failed run rejects with the active error even
when an error handler ran (the promise is an additional observer). Fully
synchronous pipelines resolve immediately, so `await` works uniformly.
Alternatively, deliver async results through a final pipe, `next`, or an
error handler.

The runner returned by `.endAsync` is reusable — call it as many times as
you like. Cancellation is per run: pass an `AbortSignal` to the runner's
`.withSignal(signal, ...args)` method for a single cancellable invocation.
An aborted run rejects with `PipelineAbortedError` — its `name` is
`AbortError`, and its `reason` carries the signal's abort reason — without
invoking the error handler. A signal already aborted at call time rejects
before the first pipe runs:

```javascript
import superpipe, { PipelineAbortedError } from 'superpipe'

const run = sp('fetch-workflow')
  .pipe(() => repository.getWorkflow(), null, 'workflow')
  .endAsync('workflow')

const controller = new AbortController()
const promise = run.withSignal(controller.signal)   // one run, one signal
controller.abort()   // elsewhere / on cancel: rejects the pending run

try {
  const workflow = await promise
  // ... use workflow
} catch (error) {
  if (!(error instanceof PipelineAbortedError)) {
    throw error   // a real pipeline failure, not a cancellation
  }
  // cancelled — nothing to do
}

// The runner itself is unaffected by the abort — keep using it:
const again = await run.withSignal(new AbortController().signal)
const plain = await run()   // no cancellation
```

Cancellation stops the run, not just the caller's view of it: when the
signal aborts, no pipe that has not started will execute, every live
`next` callback is disabled (a retained callback becomes a no-op and
releases its hold on the run's state), and the returned promise rejects
immediately with `PipelineAbortedError` — the cancellation itself never
reaches the pipeline's error handler. Continuations already in flight are
discarded when they land, errors included.

An operation already in flight is not preempted — JavaScript cannot
interrupt a running function — so a pipe whose operation ignores the
signal may still finish that operation; its result is discarded and no
downstream pipe runs. Pass the same signal into the underlying operations
(fetch, model calls) so they stop early too.

A run counts as completed only once the returned promise settles: a
successful run defers its settlement by one job (so an error dispatched in
the same unwind wins), which means an abort fired synchronously right
after `run.withSignal(...)` returns — before any `await` — still cancels a
run whose pipes all finished in that tick.

### Object-String Syntax

Use an `{a, b}` object string to destructure a single object argument into
several inputs, or to pick specific keys from a pipe's returned object as
outputs:

```javascript
// Input: pull `arg1` and `arg2` out of the single object argument
sp('my-pipeline')
  .input('{arg1, arg2}')
  .pipe(({ arg1, arg2 }) => arg1 + arg2, '{arg1, arg2}', 'sum')

// Output: pick keys from the returned object
.pipe(getProfile, 'id', '{name, email}')
```

## Error Handling

Errors can be triggered by:
1. Calling `next(error)` with an error
2. Throwing an exception in a pipe function

The active error travels on the pipeline's execution state, not the data
container: a pipe result or output named `error` is ordinary data and does
not trigger the error handler. The handler's `error` input always receives
the active failure.

```javascript
sp('safe-pipeline')
  .input(['data'])
  .pipe((data) => {
    if (!data) throw new Error('Data required')
    return data
  }, 'data', 'validated')
  .error((error) => {
    console.error('Error:', error.message)
  }, 'error')
  .end()
```

## TypeScript Support

SuperPipe is written in TypeScript and includes type definitions. Values
flowing through a pipeline (`PipeResult`, `PipeOutput`) are typed
`unknown` — the executor narrows them; input/output specs accept the
`source:destination` rename form (`PipeRename`):

```typescript
import superpipe, { Dependencies, PipelineAPI } from 'superpipe'

interface MyDeps extends Dependencies {
  logger: (msg: string) => void
}

const sp = superpipe<MyDeps>({
  logger: console.log
})
```

## License

[MIT](LICENSE)

## Bug Reports

[GitHub Issues](https://github.com/lsm/superpipe/issues)

[license-img]: https://img.shields.io/npm/l/superpipe.svg
[license-url]: http://opensource.org/licenses/MIT
[npm-img]: http://img.shields.io/npm/v/superpipe.svg
[npm-url]: https://npmjs.org/package/superpipe
[ci-img]: https://github.com/lsm/superpipe/actions/workflows/ci.yml/badge.svg
[ci-url]: https://github.com/lsm/superpipe/actions/workflows/ci.yml
[coverage-img]: https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/lsm/superpipe/badges/coverage-badge.json
[coverage-url]: https://github.com/lsm/superpipe/actions/workflows/ci.yml
[standard-img]: https://img.shields.io/badge/code_style-standard-brightgreen.svg
[standard-url]: https://standardjs.com
