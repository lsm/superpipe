# SuperPipe

[![CI status][ci-img]][ci-url]
[![License MIT][license-img]][license-url]
[![NPM version][npm-img]][npm-url]
[![Coverage Status][coverage-img]][coverage-url]
[![Code Climate][climate-img]][climate-url]

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

// Using special inputs
.pipe((next, value) => {
  setTimeout(() => next(null, 'key', value * 2), 100)
}, ['next', 'value'])
```

#### `.error(handler, input?)`

Sets an error handler for the pipeline. Only one error handler is allowed per pipeline.

```javascript
.error((error) => console.error('Pipeline error:', error), 'error')
```

#### `.end()`

Finalizes the pipeline and returns an executor function.

```javascript
const run = sp('my-pipeline')
  .input(['x'])
  .pipe(x => x * 2, 'x', 'doubled')
  .end()

run(5)  // Executes the pipeline with x=5
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

- `next`: Control when to proceed to the next pipe (for async operations)
- `set`: Manually set output values

```javascript
// Async operation with next
.pipe((next, value) => {
  fetchData(value, (err, result) => {
    next(err, 'data', result)
  })
}, ['next', 'value'], 'data')

// Manual output with set
.pipe((set, value) => {
  set('output1', value * 2)
  set('output2', value * 3)
}, ['set', 'value'], ['output1', 'output2'])
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

### Output Mapping

Rename outputs using `originalName:newName` syntax:

```javascript
.pipe(getData, 'id', 'result:userProfile')  // Maps 'result' output to 'userProfile'
```

### Plain Object Returns

Returning a plain object automatically sets all its keys as outputs:

```javascript
.pipe(() => ({ name: 'John', age: 30 }))  // Sets both 'name' and 'age'
```

## Error Handling

Errors can be triggered by:
1. Calling `next(error)` with an error
2. Setting `set('error', error)`
3. Throwing an exception in a pipe function

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
[ci-img]: https://circleci.com/gh/lsm/superpipe/tree/master.svg?style=shield
[ci-url]: https://circleci.com/gh/lsm/superpipe/tree/master
[coverage-img]: https://coveralls.io/repos/lsm/superpipe/badge.svg?branch=master&service=github
[coverage-url]: https://coveralls.io/github/lsm/superpipe?branch=master
[climate-img]: https://codeclimate.com/github/lsm/superpipe/badges/gpa.svg
[climate-url]: https://codeclimate.com/github/lsm/superpipe
