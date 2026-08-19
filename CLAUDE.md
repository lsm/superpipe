# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

SuperPipe is a lightweight functional reactive programming (FRP) library for JavaScript that provides a pipeline-based architecture for composing asynchronous operations with dependency injection. The codebase is approximately 594 lines of source code (excluding tests).

## Development Commands

### Testing
```bash
npm test                  # Run unit tests with Mocha
npm run coverage          # Run tests with coverage report
npm run watch             # Watch mode - runs coverage on changes
npm run local-browser     # Run tests in Chrome browser
npm run browser           # Run tests on Sauce Labs (CI)
```

### Building
```bash
npm run build             # Build all targets (ES, CJS, UMD)
npm run build:es          # Build ES modules → es/
npm run build:cjs         # Build CommonJS → lib/
npm run build:umd         # Build UMD development → dist/alfa.js
npm run build:umd:min     # Build UMD production → dist/alfa.min.js
```

### Running Single Tests
```bash
# Run a specific test file
mocha --require babel-core/register test/pipeline.test.js

# Run tests matching a pattern
mocha --require babel-core/register --grep "error handling"
```

## Architecture

### Core Execution Flow

The library follows a continuation-passing style (CPS) architecture:

```
superpipe(deps) → sp(name, defs) → api.pipe() → api.end() → executor(args)
                                                                    ↓
                                                              createStore()
                                                                    ↓
                                                              store.next()
                                                                    ↓
                                                            executePipe() ← (loops)
                                                                    ↓
                                                              next pipe or done
```

### Key Modules

**src/index.js** (7 lines) - Entry point that creates the main factory function

**src/pipeline.js** (205 lines) - Pipeline orchestration
- `createAPI()`: Builds the fluent API interface
- `createPipeline()`: Processes declarative pipeline definitions
- `createStore()`: Creates execution context with fresh state per execution
- `createPipeState()`: Tracks individual pipe execution state
- `execPipeline()`: Starts pipeline execution

**src/pipe.js** (181 lines) - Pipe type definitions and factory
- `createPipe()`: Main factory for different pipe types
- `createInputPipe()`: Maps function arguments to dependencies
- `createErrorPipe()`: Creates error handler pipes
- `createInjectionPipe()`: Creates pipes with dynamic dependency injection
- Supports special prefixes: `!` (not), `?` (optional)

**src/execution.js** (131 lines) - Runtime execution logic
- `executePipe()`: Executes a single pipe
- `getInputArgs()`: Resolves dependencies (supports `next`, `set`, custom deps)
- `getInjectedFunction()`: Runtime dependency resolution
- `executeInjectedFunc()`: Handles function/boolean injection

**src/set.js** (70 lines) - State management
- `setWithPipeState()`: Sets output values to store
- `checkSetAutoNext()`: Determines when to auto-advance pipeline
- Handles output mapping (e.g., `"arg2:mappedName"`)

### Dependency Resolution with getProp()

The `getProp()` function in execution.js:131 is critical for understanding dependency injection. It checks three sources in order:
1. The store (runtime values)
2. The deps object (injected dependencies)
3. Returns undefined if not found

This hybrid resolution allows pipes to reference both runtime values and pre-injected dependencies by name.

### Auto Next Behavior

Understanding auto-next is critical when working with pipes (src/pipeline.js:160-190):

- **Automatic progression**: Pipes advance automatically by default
- **Disabled when**: Pipe uses `next` in its input dependencies
- **Counted when**: Pipe has `output` array AND uses `set` in input (tracked in `pipeState.autoNext`)
- **Check logic**: `checkSetAutoNext()` in src/set.js determines when all outputs are fulfilled

### Special Pipe Features

**Boolean Control** (execution.js): Functions returning boolean values control flow
**Not Pipes** (pipe.js:84): Prefix `!` inverts boolean results
**Optional Pipes** (pipe.js:88): Prefix `?` skips pipe if dependency missing
**Output Mapping** (pipe.js:161-176): Use `output:newName` syntax to rename outputs
**Plain Object Returns** (execution.js): Returning `{ key: value }` auto-calls `set()`

### Error Handling

- Only ONE error handler per pipeline (enforced in pipeline.js:65-69)
- Error handler triggered via `next(error)` or `set('error', err)`
- Errors without handlers throw with helpful context (pipeline.js:193-205)
- Subsequent `next()` calls ignored after error triggered (pipeline.js:99-102)

## Code Style

- Biome for linting and formatting: single quotes, no semicolons (`npm run lint`, `npm run lint:fix`)
- Zero comments in `.ts` sources: no line, block, or JSDoc comments — enforced by `npm run check:no-comments` (CI). Exempt functional directives only: shebangs, `/// <reference>`, `@ts-*`, `biome-ignore`, coverage ignores (`v8`/`istanbul`/`c8`)
- TypeScript sources in `src/`, built to CJS/ESM/UMD by tsdown

## Test Organization

Tests mirror source structure:
- test/superpipe.test.js - Constructor API
- test/pipeline.test.js - Pipeline features and error handling
- test/pipe.test.js - Pipe types (input, boolean, not, optional, mapping)
- test/execution.test.js - Execution mechanics
- test/exceptions.test.js - Exception scenarios

Use Mocha + Chai (`expect` style). Tests run in Node (Mocha) and browser (Karma + Webpack).

## Build Targets

- **Node.js/CommonJS**: lib/index.js (package.json "main")
- **ES Modules**: es/index.js (package.json "module")
- **Browser/UMD**: dist/alfa.js or dist/alfa.min.js

The package supports Node >= 0.10.0 and wide browser compatibility (IE 10+, Safari 7+, Chrome 26+, Firefox 4+).
