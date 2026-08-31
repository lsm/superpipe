package superpipe

import (
	"context"
	"errors"
	"testing"
)

func TestBooleanDepTrueContinuesAndBindsResult(t *testing.T) {
	r := mustBuild(t, "truthy", Deps{"enabled": true},
		Call("enabled").Out("flag"),
		Output("flag"),
	)
	out, err := r.Run(context.Background())
	if err != nil || out != true {
		t.Fatalf("out=%v err=%v, want true", out, err)
	}
}

func TestBooleanDepFalseHaltsRun(t *testing.T) {
	ran := false
	r := mustBuild(t, "falsy", Deps{"enabled": false},
		Call("enabled"),
		Step("after", func(context.Context, []any) (any, error) {
			ran = true
			return nil, nil
		}),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v, want successful settlement", err)
	}
	if ran || out != nil {
		t.Fatalf("ran=%v out=%v, want halt with no output", ran, out)
	}
}

func TestHaltCreatesNoOutputBindings(t *testing.T) {
	r := mustBuild(t, "halt-bindings", Deps{"gate": false},
		Step("first", ret("kept")).Out("a"),
		Call("gate").Out("a"),
		Step("never", ret("nope")).Out("a"),
		Output("a"),
	)
	out, err := r.Run(context.Background())
	if err != nil || out != "kept" {
		t.Fatalf("out=%v err=%v, want kept (halt binds nothing)", out, err)
	}
}

func TestNotInvertsBooleanDep(t *testing.T) {
	ran := false
	r, err := Build("not-inverts", Deps{"isBlocked": true},
		Not("isBlocked"),
		Step("after", func(context.Context, []any) (any, error) {
			ran = true
			return nil, nil
		}),
	)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if ran {
		t.Fatal("isBlocked=true with Not halted the run, but the step after ran")
	}
}

func TestNotWithFalseContinues(t *testing.T) {
	r := mustBuild(t, "not-false", Deps{"isBlocked": false},
		Not("isBlocked").Out("v"),
		Output("v"),
	)
	out, err := r.Run(context.Background())
	if err != nil || out != true {
		t.Fatalf("out=%v err=%v, want inverted true", out, err)
	}
}

func TestNotCallableInvertsReturnedBoolean(t *testing.T) {
	deps := Deps{"check": StepFunc(func(_ context.Context, _ []any) (any, error) { return false, nil })}
	r := mustBuild(t, "not-callable", deps,
		Not("check"),
		Step("after", ret("ran")).Out("a"),
		Output("a"),
	)
	out, err := r.Run(context.Background())
	if err != nil || out != "ran" {
		t.Fatalf("out=%v err=%v, want continued after inversion to true", out, err)
	}
}

func TestNotCallableNonBooleanPassesThrough(t *testing.T) {
	deps := Deps{"check": StepFunc(func(_ context.Context, _ []any) (any, error) { return "plain", nil })}
	r := mustBuild(t, "not-string", deps,
		Not("check").Out("v"),
		Output("v"),
	)
	out, err := r.Run(context.Background())
	if err != nil || out != "plain" {
		t.Fatalf("out=%v err=%v, want plain string produced unchanged", out, err)
	}
}

func TestNotCallableHaltsOnInvertedTrue(t *testing.T) {
	deps := Deps{"check": StepFunc(func(_ context.Context, _ []any) (any, error) { return true, nil })}
	ran := false
	r := mustBuild(t, "not-halt", deps,
		Not("check"),
		Step("after", func(context.Context, []any) (any, error) {
			ran = true
			return nil, nil
		}),
	)
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if ran {
		t.Fatal("inverted true (false) should halt")
	}
}

func TestFlowControlErrorTakesPrecedenceOverHalt(t *testing.T) {
	boom := errors.New("check failed")
	deps := Deps{"check": StepFunc(func(_ context.Context, _ []any) (any, error) { return false, boom })}
	r := mustBuild(t, "err-beats-halt", deps, Not("check"))
	_, err := r.Run(context.Background())
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want the step error routing, not a halt", err)
	}
}

func TestPlainStepFalseBindsAsValue(t *testing.T) {
	r := mustBuild(t, "plain-false", nil,
		Step("s", ret(false)).Out("v"),
		Step("after", ret("ran")).Out("w"),
		OutputFields("v", "w"),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	m := out.(map[string]any)
	if m["v"] != false || m["w"] != "ran" {
		t.Fatalf("out = %#v, want v=false and continued", out)
	}
}

func TestOptionalSkipsWhenDependencyAbsent(t *testing.T) {
	r := mustBuild(t, "opt-absent", nil,
		Optional("enrich").Out("extra"),
		Step("after", ret("ran")).Out("a"),
		OutputFields("extra", "a"),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	m := out.(map[string]any)
	if v := m["extra"]; v != nil {
		t.Fatalf("extra = %v, want nil (optional skip creates no bindings)", v)
	}
	if m["a"] != "ran" {
		t.Fatalf("a = %v, want ran", m["a"])
	}
}

func TestOptionalRunsWhenDependencyPresent(t *testing.T) {
	deps := Deps{"enrich": StepFunc(func(_ context.Context, _ []any) (any, error) { return "e", nil })}
	r := mustBuild(t, "opt-present", deps,
		Optional("enrich").Out("extra"),
		Output("extra"),
	)
	if out, err := r.Run(context.Background()); err != nil || out != "e" {
		t.Fatalf("out=%v err=%v", out, err)
	}
}

func TestOptionalSkipsWhenInputAbsent(t *testing.T) {
	r := mustBuild(t, "opt-input", Deps{"enrich": 42},
		Optional("enrich").In("missing").Out("v"),
		Output("v"),
	)
	out, err := r.Run(context.Background())
	if err != nil || out != nil {
		t.Fatalf("out=%v err=%v, want skip before validation of the invalid dep", out, err)
	}
}

func TestOptionalRunsWhenInputPresentWithNil(t *testing.T) {
	deps := Deps{"enrich": StepFunc(func(_ context.Context, args []any) (any, error) {
		if len(args) != 1 || args[0] != nil {
			t.Fatalf("args = %#v, want the present-with-nil input", args)
		}
		return "ran", nil
	})}
	r := mustBuild(t, "opt-nil-input", deps,
		Input("x"),
		Optional("enrich").In("x").Out("v"),
		Output("v"),
	)
	// The invocation binds x present-with-nil: absent, not nil, is what skips.
	out, err := r.Run(context.Background(), nil)
	if err != nil || out != "ran" {
		t.Fatalf("out=%v err=%v, want the optional step to run", out, err)
	}
}

func TestOptionalNotComposes(t *testing.T) {
	ran := false
	deps := Deps{"check": true}
	r := mustBuild(t, "opt-not", deps,
		Optional(Not("check")),
		Step("after", func(context.Context, []any) (any, error) {
			ran = true
			return nil, nil
		}),
	)
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if ran {
		t.Fatal("optional-not with present true should invert and halt")
	}
}

func TestOptionalNotSkipsWhenAbsent(t *testing.T) {
	ran := false
	r := mustBuild(t, "opt-not-absent", nil,
		Optional(Not("check")),
		Step("after", func(context.Context, []any) (any, error) {
			ran = true
			return nil, nil
		}),
	)
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !ran {
		t.Fatal("optional-not with absent dep should skip, not halt")
	}
}

func TestOptionalBoolFalseHalts(t *testing.T) {
	ran := false
	r := mustBuild(t, "opt-bool-false", Deps{"gate": false},
		Optional("gate"),
		Step("after", func(context.Context, []any) (any, error) {
			ran = true
			return nil, nil
		}),
	)
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if ran {
		t.Fatal("present false boolean should halt")
	}
}

func TestGetAccessor(t *testing.T) {
	args := []any{"s", 42}
	if v, err := Get[string](args, 0); err != nil || v != "s" {
		t.Fatalf("Get[string]: %v %v", v, err)
	}
	if v, err := Get[int](args, 1); err != nil || v != 42 {
		t.Fatalf("Get[int]: %v %v", v, err)
	}
	if _, err := Get[int](args, 0); err == nil {
		t.Fatal("type mismatch should error")
	}
	if _, err := Get[string](args, 5); err == nil {
		t.Fatal("out of range should error")
	}
	if _, err := Get[string](args, -1); err == nil {
		t.Fatal("negative index should error")
	}
	var p *struct{ X int }
	if v, err := Get[*struct{ X int }]([]any{nil}, 0); err != nil || v != p {
		t.Fatalf("nil arg for pointer T: %v %v", v, err)
	}
	if _, err := Get[int]([]any{nil}, 0); err == nil {
		t.Fatal("nil arg for non-nilable T should error")
	}
}

func TestGetErrorsAreOrdinaryStepErrors(t *testing.T) {
	r := mustBuild(t, "get-err", nil,
		Step("s", func(_ context.Context, args []any) (any, error) {
			_, err := Get[int](args, 0)
			return nil, err
		}).In("x"),
	)
	_, err := r.Run(context.Background(), "not-an-int")
	if err == nil {
		t.Fatal("expected error")
	}
	if errors.Is(err, ErrOutputKey) || errors.Is(err, ErrOutputName) || errors.Is(err, ErrDependency) || errors.Is(err, ErrPanicked) || errors.Is(err, ErrAborted) || errors.Is(err, ErrInvalidDefinition) {
		t.Fatalf("Get error carries a framework sentinel: %v", err)
	}
}

func TestGetInsideAStep(t *testing.T) {
	type user struct{ ID string }
	r := mustBuild(t, "get-step", nil,
		Input("u"),
		Step("s", func(_ context.Context, args []any) (any, error) {
			u, err := Get[*user](args, 0)
			if err != nil {
				return nil, err
			}
			return u.ID, nil
		}).In("u").Out("id"),
		Output("id"),
	)
	out, err := r.Run(context.Background(), &user{ID: "u-1"})
	if err != nil || out != "u-1" {
		t.Fatalf("out=%v err=%v", out, err)
	}
}
