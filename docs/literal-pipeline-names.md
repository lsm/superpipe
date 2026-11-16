# Design: literal pipeline names (opt-in, types only)

Issue: #92. Status: proposed, waiting for sign-off before any code.

## Problem

A pipeline name is typed `string`, so `sp(name)` or `` sp(`todo.${action}`) `` compiles and a
reader cannot tell which pipeline a call builds. The issue asks for an opt-in way to refuse any
name that is not a single string literal, and to carry the literal into the runner so
`run.pipeline.name` is `'todo.remove'`, not `string`.

The issue found the blocker: `typed(deps)<[A, B]>('name')` writes the invocation arguments as an
explicit type argument, and TypeScript does not infer another type parameter (the name) once one
is written. A check on that call shape refuses even a literal.

## Decision

Opt in by giving `typed` a **pipeline registry**: a type that maps each literal name to its
invocation arguments. The name call then has a single inferred type parameter, the name, and the
arguments come from the registry instead of the call.

```ts
type Pipelines = {
  'todo.remove': [input: string, caller: Caller]
  'health.ping': []
}

const tp = typed<typeof deps, Pipelines>(deps)
// or, without restating the deps type:
const tp: TypedFactory<typeof deps, Pipelines> = typed(deps)

const remove = tp('todo.remove')
  .input(['input', 'caller'])
  .pipe(resolveTarget, 'input', 'result:outcome')
  .endAsync('outcome')

remove.pipeline.name   // type 'todo.remove'
remove('id', caller)   // parameters are Pipelines['todo.remove']
```

Without a registry nothing changes: `typed(deps)<[A, B]>('any name')` keeps its current types.

Why a registry rather than moving the arguments to a second call (`tp('x')<[A]>()`) or a new
builder method: both need new runtime code, and the issue requires none. The registry needs no
runtime change, and it is also the check a host wants: a runner can only be built under a name
the host registered, with the arguments the host declared for it.

## What the caller sees

A name outside the registry fails at the name argument (TypeScript 7, checked against a
prototype):

```
tp(name)              Argument of type 'string' is not assignable to parameter of type
                      '"health.ping" | "todo.remove"'.
tp(`todo.${action}`)  Argument of type '`todo.${string}`' is not assignable to parameter of
                      type '"health.ping" | "todo.remove"'.
tp('todo.add')        Argument of type '"todo.add"' is not assignable to parameter of type
                      '"health.ping" | "todo.remove"'.
remove(1)             Expected 2 arguments, but got 1.
```

Registry membership alone still allows a choice made at run time: an argument typed
`'todo.remove' | 'health.ping'`, or a template over a finite union such as
`` `todo.${'remove' | 'add'}` ``, has only registered alternatives. So the name call also checks
that the inferred name is a single literal, without distributing over the union, and reports a
union through its return type, the way the typed builder reports other semantic problems:

```ts
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never

<const N extends keyof R & string>(name: N):
  true extends IsUnion<N> ? TypedError<'Pipeline name must be a single string literal, not a union'>
                          : TypedPipeline<…>

tp(which).input(…)    Property 'input' does not exist on type
                      'TypedError<"Pipeline name must be a single string literal, not a union">'.
```

A literal narrowed by control flow (`if (n === 'todo.remove') tp(n)`) or held in a `const` is a
single literal and is accepted. Putting the check in the parameter type instead
(`name: N & SingleName<N>`) also refuses unions, but every diagnostic, including the membership
ones above, then degrades to "not assignable to parameter of type 'never'", so the design keeps
membership on the parameter and the singleton check on the result.

A registry whose keys are not all literals (`Record<string, …>`, or a key such as
`` `todo.${string}` ``) would let any matching name through, so the factory type becomes
`TypedError<'Pipeline registry keys must be string literals'>` and the first call fails, the same
way other typed-builder problems surface today.

## Interaction with existing types

- `TypedFactory<D>` becomes `TypedFactory<D, R = never>`. With `R` omitted it is today's type.
- The typed state gains `name` (default `string`), set from the inferred literal. `SyncRunner`
  and `TypedAsyncRunner` pass it on.
- `PipelineDescription` and `DescribedRunner` gain a name parameter with default `string`
  (`PipelineDescription<N extends string = string>`), so every existing annotation and the
  untyped `PipelineRunner` keep their current meaning.

## What stays unchanged

- No runtime change: `typed()` still returns the same builder; the registry exists only in types.
- The untyped `superpipe(deps)(name)` and the declarative form: names stay `string`.
- `typed(deps)` without a registry, including `tp<[A]>('name')`.
- The runtime shape of `run.pipeline` (#91).
- The Go port: types-only, nothing to port (its §2 row already covers `run.pipeline`).

## Acceptance cases

Type tests in `test/typed.test-d.ts`, mirrored in the verify skill's type consumer:

1. With a registry, `tp('todo.remove')` compiles and `run.pipeline.name` is `'todo.remove'`.
2. `tp(name)` with `name: string` is refused.
3. `` tp(`todo.${action}`) `` is refused.
4. An unregistered literal is refused.
5. A union of registered names (`which: 'todo.remove' | 'health.ping'`, or a function parameter
   of that type) yields the single-literal `TypedError` at the next call.
6. A template over a finite union whose alternatives are all registered
   (`` `todo.${verb}` `` with `verb: 'remove' | 'add'`) yields the same `TypedError`.
7. A literal narrowed by control flow, or held in a `const`, is accepted and keeps its literal
   `pipeline.name`.
8. The runner's parameters are the registry's tuple for that name; other arguments are refused.
9. A registry with a `string` or pattern key yields the registry-keys `TypedError` above.
10. The annotated form `const tp: TypedFactory<typeof deps, R> = typed(deps)` works.
11. Without a registry, `tp<[string]>('x')` and the untyped API compile exactly as before, and
    their `pipeline.name` stays `string`.

## Implementation slice (one PR)

- `src/typed.ts`: registry branch of `TypedFactory`, `name` in the state and the two runner types.
- `src/common.ts`: name parameter on `PipelineDescription` and `DescribedRunner`.
- README: a short "Literal pipeline names" subsection under Typed pipelines; CHANGELOG entry.
- Tests: the eleven cases above; the verify consumer gains cases 1, 2, 5 and 9.

Roughly 40 lines of type code; no `.js` output changes, which the verify skill confirms by the
unchanged runtime smoke.
