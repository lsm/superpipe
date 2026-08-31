package superpipe_test

import (
	"context"
	"errors"
	"fmt"

	superpipe "github.com/lsm/superpipe/go"
)

// The quick start from the README: declare inputs, steps, control flow, and
// the final output in one validated definition list.
func Example() {
	run, err := superpipe.Build("checkout",
		superpipe.Deps{"isBlocked": false},

		superpipe.Input("userId"),
		superpipe.Step("fetchUser", func(_ context.Context, args []any) (any, error) {
			id, _ := superpipe.Get[string](args, 0)
			return map[string]any{"id": id, "plan": "pro"}, nil
		}).In("userId").Out("user"),
		superpipe.Step("charge", func(_ context.Context, args []any) (any, error) {
			user, _ := superpipe.Get[map[string]any](args, 0)
			return "receipt-" + fmt.Sprint(user["id"]), nil
		}).In("user").Out("receipt"),
		superpipe.Not("isBlocked"),
		superpipe.Output("receipt"),
	)
	if err != nil {
		fmt.Println("build:", err)
		return
	}

	receipt, err := run.Run(context.Background(), "u-123")
	fmt.Println(receipt, err)
	// Output: receipt-u-123 <nil>
}

// The five output spec forms: whole-value, rename, pick, destructure, merge.
func Example_outputSpecs() {
	run, err := superpipe.Build("specs", nil,
		superpipe.Step("price", func(context.Context, []any) (any, error) {
			return map[string]any{"subtotal": 10, "total": 12, "tax": 2}, nil
		}).Out(superpipe.Merge()),
		superpipe.Step("line", func(context.Context, []any) (any, error) {
			return []any{"shoes", 10}, nil
		}).Out(superpipe.Destructure("item", "amount")),
		superpipe.OutputFields("subtotal", "item"),
	)
	if err != nil {
		fmt.Println("build:", err)
		return
	}
	out, err := run.Run(context.Background())
	fmt.Println(out, err)
	// Output: map[item:shoes subtotal:10] <nil>
}

// Flow control: a boolean dependency gates the rest of the pipeline.
func Example_flowControl() {
	run, err := superpipe.Build("gated", superpipe.Deps{"isBlocked": true},
		superpipe.Step("work", func(context.Context, []any) (any, error) {
			return "ran", nil
		}).Out("result"),
		superpipe.Not("isBlocked"),
		superpipe.Step("never", func(context.Context, []any) (any, error) {
			return "unreachable", nil
		}).Out("result"),
		superpipe.Output("result"),
	)
	if err != nil {
		fmt.Println("build:", err)
		return
	}
	out, err := run.Run(context.Background())
	fmt.Println(out, err)
	// Output: ran <nil>
}

// Errors settle uniformly: the handler observes the failed run, and the
// caller still receives the active error with a nil result.
func Example_errors() {
	boom := errors.New("card declined")
	run, err := superpipe.Build("charged", nil,
		superpipe.Step("charge", func(context.Context, []any) (any, error) {
			return nil, boom
		}),
		superpipe.Error("logFailure", func(_ context.Context, args []any) error {
			fmt.Println("handler saw:", args[0])
			return nil
		}).In("error"),
	)
	if err != nil {
		fmt.Println("build:", err)
		return
	}
	out, err := run.Run(context.Background())
	fmt.Println("result:", out)
	fmt.Println("errors.Is(err, boom):", errors.Is(err, boom))
	// Output:
	// handler saw: card declined
	// result: <nil>
	// errors.Is(err, boom): true
}

// Cancellation is context.Context, observed at the run's boundaries.
func Example_cancellation() {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	run, err := superpipe.Build("aborted", nil,
		superpipe.Step("work", func(context.Context, []any) (any, error) {
			return "never runs", nil
		}),
	)
	if err != nil {
		fmt.Println("build:", err)
		return
	}
	_, err = run.Run(ctx)
	fmt.Println("aborted:", errors.Is(err, superpipe.ErrAborted))
	// Output: aborted: true
}
