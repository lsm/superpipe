# SuperPipe for Go

A pipeline engine whose value is that **invariants live in the executor, not in
call-site discipline**: inputs, outputs, one error path, and one cancellation
gate are declared up front, validated before the first run, and enforced
centrally. This module is the Go port of [SuperPipe][npm] — same semantics,
idiomatic Go spelling. The full contract is specified in
[`docs/go-port-spec.md`](../docs/go-port-spec.md); this README is the user guide.

## Install

Requires Go 1.22 or later.

```sh
go get github.com/lsm/superpipe/go
```

```go
import superpipe "github.com/lsm/superpipe/go"
```

## Quick start

```go
run, err := superpipe.Build("checkout",
	superpipe.Deps{"db": db, "isBlocked": false},

	superpipe.Input("userId"),
	superpipe.Step("fetchUser", fetchUser).In("userId").Out("user"),
	superpipe.Step("charge", charge).In("user").Out("receipt"),
	superpipe.Not("isBlocked"),
	superpipe.Output("receipt"),
)
if err != nil {
	return err // every construction violation, joined
}

receipt, err := run.Run(ctx, "u-123")
```

`Build` validates the whole definition once and returns an immutable `*Runner`.
`Run` blocks on the caller's goroutine until the pipeline settles — there is no
async variant; `go` plus a channel is the Go spelling of a future, and it
belongs to you.

## Definitions

A pipeline is a list of definitions. Order matters: input defs first, then
steps, at most one error handler last. The `Output` def may appear anywhere;
the last one wins.

| Definition | Meaning |
| --- | --- |
| `Input("a", "b")` | Bind invocation args positionally to names. |
| `InputFromObject("a", "b")` | Pick keys from the first invocation arg (maps, slices, strings support indexes and `length`). |
| `Step("name", fn)` | Run `fn`, a `StepFunc`. |
| `Call("dep")` | Resolve `dep` from the container/deps at run time and run it; a bool dep is flow control. |
| `Not("dep")` | Like `Call`, inverting a boolean result (`false` halts). |
| `Optional("dep")` / `Optional(Not("dep"))` | Skipped when the dep or any declared input is absent. |
| `Error("name", fn)` | The single error handler. |
| `ErrorCall("dep")` | Error handler resolved by name at error time. |
| `Output("receipt")` | Final output: one name → the value; several → `[]any`. |
| `OutputFields("a", "b")` | Final output as `map[string]any`. |

Each step chains its own inputs and output:

- `.In("userId")` — positional inputs, resolved from the run container first,
  then `Deps`; an absent name delivers `nil`.
- `.InFields("error", "key")` — one `map[string]any` argument instead of
  positional ones.
- `.Out("user")` or `.Out(spec)` — the output spec (below).
- A step with no `.In` receives the invocation args themselves.

## Output specs

One constructor, one meaning — the TS string mini-grammar becomes types:

| Constructor | Binds |
| --- | --- |
| `Out("user")` | The whole return value to `user`. |
| `Rename("src", "dst")` | Return must be a map; picks `src`, binds it as `dst`. |
| `Pick("a", "b")` | Return must be a map; picks the named keys (accepts `"src:dst"` renames). |
| `Destructure("a", "b")` | Array return → positional; map return → picks by name. |
| `Merge()` | Return must be a map; merges every key into the container. |

`Pick`, `Destructure`, and `Merge` require a value: a step returning nothing
under one of them fails with `ErrOutputKey`. `Out` accepts a nil return and
simply binds nothing. Structs are not maps — return a map, or bind the whole
value with `Out`.

## Steps

```go
type StepFunc func(ctx context.Context, args []any) (any, error)
```

A step blocks until it has its result; the return is the only continuation
channel (there is no `next` callback). Use `Get` at the top of the body
instead of naked assertions:

```go
superpipe.Step("charge", func(ctx context.Context, args []any) (any, error) {
	user, err := superpipe.Get[*User](args, 0)
	if err != nil {
		return nil, err // an ordinary step error
	}
	return chargeCard(ctx, user)
}).In("user").Out("receipt"),
```

`Get[T]` returns the zero value for a nilable `T` on a nil argument, and an
error naming position and types on mismatch or out-of-range — never a panic.

## Flow control

A boolean-resolved step — `Not(...)`, or `Call`/`Optional` resolving to a bool
dependency — controls flow: `true` continues (and is produced like any value),
`false` **halts** the run, which then settles successfully with the partial
snapshot. `Not` inverts only booleans; any other value passes through and is
produced normally. A step error always takes precedence over a halt.

## Errors

Errors reach the engine as a step's non-nil error return (recovered panics
included — a non-error panic value is converted to an error wrapping
`ErrPanicked`). Settlement is uniform: **`Run` always returns the active error
and a nil result**, with or without a handler.

```go
superpipe.Error("logFailure", func(ctx context.Context, args []any) error {
	err, _ := superpipe.Get[error](args, 0)
	writeToDLQ(ctx, err)
	return nil // a non-nil return joins the settlement error
}).In("error", "orderId"),
```

The default input (no `.In`) is the active error alone; declared inputs
resolve against the snapshot — the error under the `error` key plus every
container binding made before the failure. `.InFields("error", "orderId")`
delivers the same names as one `map[string]any` argument instead.

The handler observes a snapshot of the container plus the original error under
the `error` key, runs on a detached context, and never runs on an aborted run.
It is likewise bypassed by **definition errors** — a reserved or shadowed
output name (`ErrOutputName`), a spec/shape mismatch (`ErrOutputKey`), an
unusable dependency (`ErrDependency`), or anything `Build` would have caught
(`ErrInvalidDefinition`) — which propagate as themselves, wrapped in nothing.
A converted panic is different: it wraps `ErrPanicked` and routes to the
handler like any step failure, with step context attached. Every category
stays findable with `errors.Is`:

```go
_, err := run.Run(ctx, "u-123")
switch {
case errors.Is(err, superpipe.ErrAborted):
case errors.Is(err, superpipe.ErrOutputName):
case err != nil:
	return fmt.Errorf("checkout failed: %w", err)
}
```

## Cancellation

Cancellation is `context.Context`, observed at four boundaries: before
invocation inputs, before each step, when a step's return lands (an in-flight
result is discarded), and before successful settlement.

```go
ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
defer cancel()
receipt, err := run.Run(ctx, "u-123")
if errors.Is(err, superpipe.ErrAborted) { /* ctx won the race */ }
```

Steps should pass `ctx` into their own I/O so they stop early; the engine
guarantees what starts and what lands, not preemption of user code. A
`Run` blocked on a ctx-ignoring step returns when that step returns.

## Concurrency

The `*Runner` is immutable: run it from as many goroutines as you like. Each
`Run` gets fresh state. `Deps` is retained live by reference — mutations
between runs are observed (like the TS library), so synchronize mutations
between runs as with any shared map.

## What is deliberately different from the TS library

- No `next` callback and no async entry point — steps block; one `Run`.
- Typed constructors replace the string mini-grammar (`'{a, b}'` → `Pick`,
  `'src:dst'` → `Rename`, `'{...}'` → `Merge`); names that the reference
  grammar would reclassify are construction errors.
- `context.Context` replaces `AbortSignal`; cancellation never routes to the
  error handler.
- A handled error is still returned to the caller with a nil result.
- Reads are plain map/index accesses — no accessors, no prototype chain.

The complete divergence catalog and every contract live in
[`docs/go-port-spec.md`](../docs/go-port-spec.md).

[npm]: https://www.npmjs.com/package/superpipe
