# SuperPipe

[![CI status][ci-img]][ci-url]
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
- Control flow (stop execution by returning `false`)

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

When a pipe returns `false`, the pipeline stops (useful for guards/validation):

```javascript
.pipe(user => user.isAdmin, 'user')  // Stops if not admin
.pipe(() => console.log('Admin access granted'))
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

### Asynchronous Pipelines and `.end(output)`

The executor returned by `.end()` completes synchronously. When a pipe uses
`next` and resolves asynchronously, values produced later are not reflected in
`.end(output)`'s return value — deliver async results through a final pipe,
`next`, or an error handler instead.

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

SuperPipe is written in TypeScript and includes type definitions:

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
[standard-img]: https://img.shields.io/badge/code_style-standard-brightgreen.svg
[standard-url]: https://standardjs.com
