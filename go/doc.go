// Package superpipe is the Go port of the SuperPipe pipeline engine.
//
// A pipeline is built from a validated definition list and executed by a
// blocking Run; every contract is specified in docs/go-port-spec.md:
//
//	run, err := superpipe.Build("checkout",
//	    superpipe.Deps{"db": db, "isBlocked": false},
//	    superpipe.Input("userId"),
//	    superpipe.Step("fetchUser", fetchUser).In("userId").Out("user"),
//	    superpipe.Not("isBlocked"),
//	    superpipe.Output("user"),
//	)
//	out, err := run.Run(ctx, "u-123")
//
// A step is func(ctx context.Context, args []any) (any, error): it blocks
// until it has its result, and its return is the only continuation channel.
// Result(name) opts a step into business-result handling: Value(v) binds and
// continues, while Reason(r) binds and stops the run successfully.
// Errors are uniform — the caller always receives the active error, with an
// optional error handler observing the failed run — and cancellation is
// cooperative context.Context gating at step boundaries.
package superpipe
