package superpipe

import (
	"context"
	"errors"
	"sync"
	"testing"
)

func TestResultValueContinuesAndBinds(t *testing.T) {
	r := mustBuild(t, "result-value", nil,
		Step("lookup", func(context.Context, []any) (any, error) { return Value(2), nil }).Out(Result("count")),
		Step("increment", func(_ context.Context, args []any) (any, error) { return args[0].(int) + 1, nil }).In("count").Out("out"),
		Output("out"),
	)
	out, err := r.Run(context.Background())
	if err != nil || out != 3 {
		t.Fatalf("out=%v err=%v, want 3, nil", out, err)
	}
}

func TestResultReasonBindsAndSkipsLaterSteps(t *testing.T) {
	ran := false
	r := mustBuild(t, "result-reason", nil,
		Step("lookup", func(context.Context, []any) (any, error) { return Reason("missing"), nil }).Out(Result("user")),
		Step("later", func(context.Context, []any) (any, error) { ran = true; return "unexpected", nil }).Out("later"),
		Output("user"),
	)
	out, err := r.Run(context.Background())
	if err != nil || out != "missing" || ran {
		t.Fatalf("out=%v err=%v ran=%v, want missing, nil, false", out, err, ran)
	}
}

func TestResultNilPayloadsAreBound(t *testing.T) {
	for _, result := range []Outcome{Value[any](nil), Reason[any](nil)} {
		r := mustBuild(t, "result-nil", nil,
			Step("result", func(context.Context, []any) (any, error) { return result, nil }).Out(Result("out")),
			OutputFields("out"),
		)
		out, err := r.Run(context.Background())
		if err != nil || out.(map[string]any)["out"] != nil {
			t.Fatalf("out=%#v err=%v, want present nil and nil", out, err)
		}
	}
}

func TestResultSelectedOutputAndFields(t *testing.T) {
	r := mustBuild(t, "result-output", nil,
		Step("first", func(context.Context, []any) (any, error) { return Value("kept"), nil }).Out(Result("first")),
		Step("second", func(context.Context, []any) (any, error) { return Reason("stop"), nil }).Out(Result("second")),
		OutputFields("first", "second"),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if got := out.(map[string]any); got["first"] != "kept" || got["second"] != "stop" {
		t.Fatalf("out=%#v, want both result bindings", out)
	}
}

func TestResultRejectsNonResultValues(t *testing.T) {
	for _, value := range []any{nil, "value", map[string]any{"value": 1}, map[string]any{"reason": "stop"}, map[string]any{"value": 1, "reason": "stop"}} {
		r := mustBuild(t, "bad-result", nil,
			Step("s", func(context.Context, []any) (any, error) { return value, nil }).Out(Result("out")),
		)
		if _, err := r.Run(context.Background()); !errors.Is(err, ErrOutputKey) {
			t.Fatalf("value=%#v err=%v, want ErrOutputKey", value, err)
		}
	}
}

func TestResultRejectsEmbeddedOutcome(t *testing.T) {
	type embeddedOutcome struct{ Outcome }
	r := mustBuild(t, "embedded-result", nil,
		Step("s", func(context.Context, []any) (any, error) { return embeddedOutcome{}, nil }).Out(Result("out")),
	)
	if _, err := r.Run(context.Background()); !errors.Is(err, ErrOutputKey) {
		t.Fatalf("err=%v, want ErrOutputKey", err)
	}
}

func TestResultErrorPrecedenceIgnoresPartialResult(t *testing.T) {
	boom := errors.New("boom")
	handled := false
	r := mustBuild(t, "result-error", nil,
		Step("s", func(context.Context, []any) (any, error) { return Reason("not a success"), boom }).Out(Result("out")),
		Error("handler", func(_ context.Context, args []any) error { handled = args[0] == boom; return nil }).In("error"),
	)
	if out, err := r.Run(context.Background()); out != nil || !errors.Is(err, boom) || !handled {
		t.Fatalf("out=%v err=%v handled=%v, want nil, boom, true", out, err, handled)
	}
}

func TestOptionalResultSkipCreatesNoBindings(t *testing.T) {
	r := mustBuild(t, "optional-result", nil,
		Optional("missing").Out(Result("out")),
		Step("later", func(context.Context, []any) (any, error) { return "ran", nil }).Out("later"),
		OutputFields("out", "later"),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	got := out.(map[string]any)
	if got["out"] != nil || got["later"] != "ran" {
		t.Fatalf("out=%#v, want skipped result and later binding", out)
	}
}

func TestResultDefinitionValidation(t *testing.T) {
	for _, name := range []string{"", "a:b", "...", "...out"} {
		_, err := Build("bad-result", nil, Step("s", ret(nil)).Out(Result(name)))
		if !errors.Is(err, ErrInvalidDefinition) {
			t.Fatalf("name=%q err=%v, want ErrInvalidDefinition", name, err)
		}
	}
}

func TestOrdinaryMapsRemainDataOutsideResult(t *testing.T) {
	data := map[string]any{"error": "data", "value": 1, "reason": "not control"}
	r := mustBuild(t, "ordinary-data", nil,
		Step("s", func(context.Context, []any) (any, error) { return data, nil }).Out("payload"),
		Step("read", func(_ context.Context, args []any) (any, error) { return args[0].(map[string]any)["error"], nil }).In("payload").Out("out"),
		Output("out"),
	)
	if out, err := r.Run(context.Background()); err != nil || out != "data" {
		t.Fatalf("out=%v err=%v, want data, nil", out, err)
	}
}

func TestLegacyRenameStillWorks(t *testing.T) {
	r := mustBuild(t, "legacy-rename", nil,
		Step("s", func(context.Context, []any) (any, error) { return map[string]any{"result": "data"}, nil }).Out(Rename("result", "user")),
		Output("user"),
	)
	if out, err := r.Run(context.Background()); err != nil || out != "data" {
		t.Fatalf("out=%v err=%v, want data, nil", out, err)
	}
}

func TestResultCancellationWinsAtLanding(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	ran := false
	r := mustBuild(t, "result-cancel", nil,
		Step("result", func(context.Context, []any) (any, error) { cancel(); return Reason("stop"), nil }).Out(Result("out")),
		Step("later", func(context.Context, []any) (any, error) { ran = true; return nil, nil }),
		Output("out"),
	)
	out, err := r.Run(ctx)
	if out != nil || !errors.Is(err, ErrAborted) || ran {
		t.Fatalf("out=%v err=%v ran=%v, want nil, ErrAborted, false", out, err, ran)
	}
}

func TestResultRunsAreConcurrentAndIsolated(t *testing.T) {
	r := mustBuild(t, "result-concurrent", nil,
		Input("result"),
		Step("s", func(_ context.Context, args []any) (any, error) { return args[0], nil }).In("result").Out(Result("out")),
		Output("out"),
	)
	values := []Outcome{Value("value"), Reason("reason")}
	var wg sync.WaitGroup
	errs := make(chan error, len(values))
	for _, value := range values {
		wg.Add(1)
		go func(value Outcome) {
			defer wg.Done()
			out, err := r.Run(context.Background(), value)
			if err != nil || (out != "value" && out != "reason") {
				errs <- errors.New("result run was not isolated")
			}
		}(value)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestBooleanHaltRemainsUnchangedWithResultSupport(t *testing.T) {
	ran := false
	r := mustBuild(t, "boolean-halt", Deps{"gate": false},
		Call("gate").Out(Result("out")),
		Step("later", func(context.Context, []any) (any, error) { ran = true; return nil, nil }),
		Output("out"),
	)
	out, err := r.Run(context.Background())
	if err != nil || out != nil || ran {
		t.Fatalf("out=%v err=%v ran=%v, want nil, nil, false", out, err, ran)
	}
}
