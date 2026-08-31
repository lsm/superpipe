package superpipe

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestPreCancelledContextRunsNothing(t *testing.T) {
	ran := false
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	inputRan := false
	r := mustBuild(t, "pre-cancelled", nil,
		Input("x"),
		Step("s", func(context.Context, []any) (any, error) {
			ran = true
			return nil, nil
		}).In("x"),
		Step("i", func(context.Context, []any) (any, error) {
			inputRan = true
			return nil, nil
		}),
	)
	_ = inputRan
	out, err := r.Run(ctx, 1)
	if !errors.Is(err, ErrAborted) {
		t.Fatalf("err = %v, want ErrAborted", err)
	}
	if out != nil {
		t.Fatalf("out = %v, want nil", out)
	}
	if ran {
		t.Fatal("a step ran under a pre-cancelled context")
	}
}

func TestPreCancelledContextSkipsInputDefs(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	r := mustBuild(t, "pre-input", nil, Input("x"), Output("x"))
	if _, err := r.Run(ctx, 1); !errors.Is(err, ErrAborted) {
		t.Fatalf("err = %v, want ErrAborted", err)
	}
}

func TestStepFreePipelineObservesSettlementBoundary(t *testing.T) {
	r := mustBuild(t, "step-free", nil, Input("x"))
	if _, err := r.Run(context.Background(), 1); err != nil {
		t.Fatalf("Run: %v", err)
	}
}

func TestCancellationSkipsUnstartedSteps(t *testing.T) {
	ranAfter := false
	ctx, cancel := context.WithCancel(context.Background())
	r := mustBuild(t, "mid-run", nil,
		Step("trigger", func(c context.Context, _ []any) (any, error) {
			cancel()
			return "v", nil
		}).Out("a"),
		Step("after", func(context.Context, []any) (any, error) {
			ranAfter = true
			return nil, nil
		}),
	)
	_, err := r.Run(ctx)
	if !errors.Is(err, ErrAborted) {
		t.Fatalf("err = %v, want ErrAborted", err)
	}
	if ranAfter {
		t.Fatal("a step after cancellation ran")
	}
}

func TestInFlightStepResultDiscardedAtLanding(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	release := make(chan struct{})
	handlerRan := false
	r := mustBuild(t, "in-flight", nil,
		Step("blocker", func(c context.Context, _ []any) (any, error) {
			<-c.Done()
			close(release)
			return "value", nil
		}).Out("a"),
		Step("after", func(context.Context, []any) (any, error) { return "never", nil }),
		Error("h", func(context.Context, []any) error {
			handlerRan = true
			return nil
		}),
		Output("a"),
	)
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()
	out, err := r.Run(ctx)
	if !errors.Is(err, ErrAborted) {
		t.Fatalf("err = %v, want ErrAborted", err)
	}
	if out != nil {
		t.Fatalf("out = %v, want nil", out)
	}
	if handlerRan {
		t.Fatal("handler ran for a cancellation")
	}
	<-release
}

func TestInFlightStepErrorDroppedAtLanding(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	handlerRan := false
	r := mustBuild(t, "in-flight-err", nil,
		Step("blocker", func(c context.Context, _ []any) (any, error) {
			<-c.Done()
			return nil, errors.New("dropped")
		}),
		Error("h", func(context.Context, []any) error {
			handlerRan = true
			return nil
		}),
	)
	go func() {
		time.Sleep(10 * time.Millisecond)
		cancel()
	}()
	if _, err := r.Run(ctx); !errors.Is(err, ErrAborted) {
		t.Fatalf("err = %v, want ErrAborted (the step error is dropped)", err)
	}
	if handlerRan {
		t.Fatal("handler ran for a cancellation")
	}
}

func TestAbortedErrorCarriesCause(t *testing.T) {
	ctx, cancel := context.WithCancelCause(context.Background())
	cause := errors.New("user navigated away")
	cancel(cause)
	r := mustBuild(t, "cause", nil, Step("s", ret("v")))
	_, err := r.Run(ctx)
	if !errors.Is(err, ErrAborted) {
		t.Fatalf("err = %v, want ErrAborted", err)
	}
	var ae *AbortedError
	if !errors.As(err, &ae) || ae.Reason != cause {
		t.Fatalf("err = %v, want AbortedError with the cause", err)
	}
}

func TestCancellationAfterActiveErrorChangesNothing(t *testing.T) {
	boom := errors.New("boom")
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	handlerDone := make(chan struct{})
	r := mustBuild(t, "after-error", nil,
		Step("fail", retErr(nil, boom)),
		Error("h", func(c context.Context, args []any) error {
			// The cancellation arrives after the error is observed: inside
			// the handler, which itself runs on a detached context.
			cancel()
			select {
			case <-c.Done():
				t.Error("handler context was cancelled; want detached")
			default:
			}
			if !errors.Is(args[0].(error), boom) {
				t.Errorf("handler saw %v, want the active error", args[0])
			}
			close(handlerDone)
			return nil
		}),
	)
	_, err := r.Run(ctx)
	if !errors.Is(err, boom) || errors.Is(err, ErrAborted) {
		t.Fatalf("err = %v, want the active error, not AbortedError", err)
	}
	<-handlerDone
}

func TestCancellationDuringStepYieldsAbortedError(t *testing.T) {
	// Cancellation observed at the step's landing boundary discards the
	// in-flight result, its error included — matching the reference, where
	// cancelRun settles before the pipe's own continuation lands.
	boom := errors.New("boom")
	ctx, cancel := context.WithCancel(context.Background())
	r := mustBuild(t, "during-step", nil,
		Step("fail", func(c context.Context, _ []any) (any, error) {
			cancel()
			return nil, boom
		}),
	)
	if _, err := r.Run(ctx); !errors.Is(err, ErrAborted) {
		t.Fatalf("err = %v, want ErrAborted", err)
	}
}

func TestCallerObservesMidStepAbortWhenStepReturns(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	released := make(chan struct{})
	r := mustBuild(t, "mid-step", nil,
		Step("blocker", func(c context.Context, _ []any) (any, error) {
			defer close(released)
			<-c.Done()
			return "discarded", nil
		}).Out("a"),
	)
	results := make(chan error, 1)
	go func() {
		_, err := r.Run(ctx, 1)
		results <- err
	}()
	time.Sleep(10 * time.Millisecond)
	cancel()
	<-released
	select {
	case err := <-results:
		if !errors.Is(err, ErrAborted) {
			t.Fatalf("err = %v, want ErrAborted", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after the in-flight step settled")
	}
}

func TestConcurrentRunsOnOneRunner(t *testing.T) {
	r := mustBuild(t, "concurrent", nil,
		Input("n"),
		Step("double", func(_ context.Context, args []any) (any, error) {
			n, err := Get[int](args, 0)
			if err != nil {
				return nil, err
			}
			return n * 2, nil
		}).In("n").Out("d"),
		Output("d"),
	)
	var wg sync.WaitGroup
	for i := 1; i <= 50; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			out, err := r.Run(context.Background(), n)
			if err != nil {
				t.Errorf("run %d: %v", n, err)
				return
			}
			if out != n*2 {
				t.Errorf("run %d: out = %v", n, out)
			}
		}(i)
	}
	wg.Wait()
}

func TestDepsMutationsObservedBetweenRuns(t *testing.T) {
	deps := Deps{"mode": "a"}
	r := mustBuild(t, "live-deps", deps,
		Call("mode").Out("v"),
		Output("v"),
	)
	deps["mode"] = StepFunc(func(_ context.Context, _ []any) (any, error) { return "b", nil })
	out, err := r.Run(context.Background())
	if err != nil || out != "b" {
		t.Fatalf("out=%v err=%v, want the post-build mutation observed", out, err)
	}
}
