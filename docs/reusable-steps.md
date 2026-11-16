# Design: a reusable run of steps included by reference (`.use`)

Issue: #93. Status: proposed, waiting for sign-off before any code. Names (`steps`, `use`,
`part`) are placeholders the human may change; see open questions.

## Problem

Pipelines that share their first steps have no declared way to say so. Call sites pass a
half-built builder through helper functions, so one pipeline's name, inputs and first steps live
in different places and neither a reader nor `run.pipeline` shows that a run of steps is shared.

## Decision

A **part** is a named, frozen list of steps declared from the same factory as the pipelines that
use it. `.use(part)` appends the part's steps at that point, exactly as if they were written
inline.

```ts
const sp = superpipe(deps)

const owned = sp.steps('goal.owned')
  .pipe(resolveOwner, ['caller', 'input'], 'result:outcome')
  .pipe('!isArchived', 'outcome')

const create = sp('goal.create')
  .input(['input', 'caller'])
  .use(owned)
  .pipe(createGoal, ['outcome', 'input'], 'outcome')
  .endAsync('outcome')
```

- `sp.steps(name)` returns an empty part. A part has one method, `.pipe(fn, input?, output?)`,
  with the same arguments and errors as the pipeline's `.pipe`. It returns a **new** frozen part,
  so a part that is already used is never changed by a later `.pipe` on it.
- A part owns its specs. At declaration it copies each `input`/`output` array into a private
  frozen array and builds its steps from those copies; the caller's arrays are neither kept nor
  frozen. Without the copy, a later `keys[0] = 'input'` on an array passed to `.pipe` would change
  what every pipeline using the part binds, because the builder's fetcher and producer keep the
  array they were given. Step functions and the deps object stay references, as they are for
  inline steps: a function is the step, and deps are live by design.
- A part holds steps only. `.pipe('input', …)` and `.pipe('error', …)`, which a pipeline
  dispatches to `.input()`/`.error()`, throw on a part: inputs, the error handler and exit
  observers belong to the pipeline.
- `pipeline.use(part)` follows the same ordering rules as `.pipe`: allowed only before `.error()`,
  and `.input()` after it throws. A part may be used by any number of pipelines, and more than
  once in one pipeline.

## How a run sees it

The steps are copied into the pipeline at `.use`, so the executor does not change. Values,
`result:` exits, `!` halts, `?` skips, thrown errors and their handler, `next`, promises and
cancellation behave exactly as for the same steps written inline. Injected names in a part
resolve against the deps of the pipeline that runs it, which is the factory's deps.

The exit channel reports the step's position in the whole pipeline (`exit.step`) and its own
name (`exit.name`), as today.

## `run.pipeline`

Steps from a part appear in place, in order, with one extra field naming the part:

```js
create.pipeline.steps
// [
//   { name: 'resolveOwner', injected: false, not: false, optional: false,
//     input: ['caller', 'input'], output: 'result:outcome', part: 'goal.owned' },
//   { name: 'isArchived', injected: true, not: true, optional: false,
//     input: 'outcome', part: 'goal.owned' },
//   { name: 'createGoal', injected: false, not: false, optional: false,
//     input: ['outcome', 'input'], output: 'outcome' },
// ]
```

Inline steps have no `part` field, the same way an undeclared spec is left out.

## Typed entry

The first slice refuses `.use` on the `typed()` builder with a clear type error, the pattern the
builder already uses for unavailable methods (for example `.input()` after a pipe): `use` is
typed as `(part: 'Parts are not typed yet; build this pipeline with superpipe(deps)') => never`,
so passing a part fails at the argument with that message.

Carrying the context through a part needs the part to declare the context it reads; that is a
follow-up design, not part of this slice (open question 2).

## Go port

Not TypeScript-only in substance: Go already composes a definition list, because `Build` takes
`defs ...Def`. A part is a `[]superpipe.Def` and including it is `append`:

```go
owned := []superpipe.Def{
	superpipe.Step("resolveOwner", resolveOwner).In("caller", "input").Out(superpipe.Result("outcome")),
}
defs := append([]superpipe.Def{superpipe.Input("input", "caller")}, owned...)
run, err := superpipe.Build("goal.create", deps, append(defs,
	superpipe.Step("createGoal", createGoal).In("outcome", "input").Out("outcome"),
	superpipe.Output("outcome"),
)...)
```

`Build` clones every definition, including its name slices, so each runner is a snapshot of the
shared `owned` slice. So the Go port needs no code. The slice adds a row to §2 of `docs/go-port-spec.md`: "`.use(part)`
| a `[]Def` slice spread into `Build` | Go composes variadic definition lists natively". The
`part` field of the description has no Go counterpart because Go has no `run.pipeline` (already
recorded in §2).

## What stays unchanged

- The executor, `Pipe`, `Fetcher` and `Producer`.
- Every existing builder method and the declarative form.
- `run.pipeline` for pipelines that use no part.
- The exit channel's fields.

## Acceptance cases

Contract tests (`test/flow-control-contract.test.mjs` for behavior,
`test/pipeline-description.test.mjs` for the description) compare each pipeline with `.use`
against the same steps written inline, for `.end` and `.endAsync`:

1. Values: same final output.
2. A `result:` reason in a part step: same outcome and same exit (`via`, `step`, `name`).
3. A `!` gate in a part halts the same way.
4. A step in a part throws: same error reaches the pipeline's handler and the caller.
5. Abort through `withSignal` while a part step is pending: `PipelineAbortedError`, handler not
   called.
6. `run.pipeline` lists the part's steps in place with `part`; inline steps have none.
7. Extending a used part returns a new part; the earlier runner and its description are
   unchanged; a part is frozen.
8. The caller mutates the `input` and `output` arrays it passed to a part's `.pipe` after
   declaring the part, and again after a first pipeline used it; two runners built from the part
   still bind the declared names, their descriptions show them, and the caller's arrays are not
   frozen.
9. `part.pipe('input', …)` and `part.pipe('error', …)` throw; `.use` after `.error()` throws;
   `.input()` after `.use` throws.
10. Type test: `.use` on a `typed()` builder fails with the message above; the untyped `.use` is
    typed to return the builder.

The verify skill's smoke gains cases 1, 6 and 8 through the installed package.

## Implementation slice (one PR)

- `src/index.ts`: `sp.steps(name)` on the factory.
- `src/pipeline/Pipeline.ts`: the frozen part type (copying spec arrays at declaration) and
  `use(part)`.
- `src/pipeline/builder.ts`: pipes created by a part carry its name; `describePipeline` emits
  `part`.
- `src/common.ts`: `part?: string` on `StepDescription`.
- `src/typed.ts`: the `.use` refusal.
- README subsection, CHANGELOG entry, the contract tests above, the §2 row, the verify smoke.

Roughly 60 lines of production code.

## Open questions for the human

1. Names: `sp.steps(name)`, `.use(part)`, and the description field `part`.
2. Typed builder: refuse `.use` in this slice (recommended, smallest) or require typed support
   before merge?
3. Declarative form: add `['use', part]` now, or leave it out (recommended) until asked for?
4. May a part `.use` another part? Recommended: no in this slice; steps stay one level deep and
   `part` is a single name.
5. A part from a different `superpipe(deps)` factory: throw at `.use` (recommended: the part's
   injected names were declared against those deps), or allow it?
