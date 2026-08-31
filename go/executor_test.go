package superpipe

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestContainerOverridesDepsForReads(t *testing.T) {
	r := mustBuild(t, "override", Deps{"x": "dep"},
		Input("x"),
		Step("read", func(_ context.Context, args []any) (any, error) { return args[0], nil }).In("x").Out("seen"),
		Output("seen"),
	)
	out, err := r.Run(context.Background(), "run")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "run" {
		t.Fatalf("out = %v, want run (container read wins over the dep)", out)
	}
}

func TestAbsentInputDeliversNil(t *testing.T) {
	r := mustBuild(t, "absent", nil,
		Step("s", func(_ context.Context, args []any) (any, error) {
			if args[0] != nil {
				t.Fatalf("args[0] = %v, want nil", args[0])
			}
			return "ok", nil
		}).In("missing"),
	)
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
}

func TestFinalOutputResolvesFromDeps(t *testing.T) {
	r := mustBuild(t, "from-deps", Deps{"config": "cfg"}, Output("config"))
	out, err := r.Run(context.Background())
	if err != nil || out != "cfg" {
		t.Fatalf("out=%v err=%v", out, err)
	}
}

func TestFinalOutputAbsentFromBothIsNil(t *testing.T) {
	r := mustBuild(t, "absent-out", nil, Output("nothing"))
	out, err := r.Run(context.Background())
	if err != nil || out != nil {
		t.Fatalf("out=%v err=%v", out, err)
	}
}

func TestOutputDuplicatesRetainedInOrder(t *testing.T) {
	r := mustBuild(t, "dups", nil,
		Step("s", ret("v")).Out("x"),
		Output("x", "x"),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	arr, ok := out.([]any)
	if !ok || len(arr) != 2 || arr[0] != "v" || arr[1] != "v" {
		t.Fatalf("out = %#v, want [v v]", out)
	}
}

func TestCallResolvesDepFunctionByName(t *testing.T) {
	deps := Deps{"audit": func(_ context.Context, _ []any) (any, error) { return "audited", nil }}
	r := mustBuild(t, "call", deps,
		Call("audit").Out("result"),
		Output("result"),
	)
	out, err := r.Run(context.Background())
	if err != nil || out != "audited" {
		t.Fatalf("out=%v err=%v", out, err)
	}
}

func TestCallAcceptsNamedTypeWithStepFuncSignature(t *testing.T) {
	type auditFn func(context.Context, []any) (any, error)
	var fn auditFn = func(_ context.Context, _ []any) (any, error) { return 1, nil }
	r := mustBuild(t, "named-type", Deps{"audit": fn},
		Call("audit").Out("v"),
		Output("v"),
	)
	if out, err := r.Run(context.Background()); err != nil || out != 1 {
		t.Fatalf("out=%v err=%v", out, err)
	}
}

func TestAbsentInjectedNameFailsWithDependencyError(t *testing.T) {
	r := mustBuild(t, "absent-dep", nil, Call("nope"))
	_, err := r.Run(context.Background())
	if !errors.Is(err, ErrDependency) {
		t.Fatalf("err = %v, want ErrDependency", err)
	}
}

func TestInvalidInjectedValueFailsBeforeInvocation(t *testing.T) {
	r := mustBuild(t, "invalid-dep", Deps{"dep": 42},
		Call("dep").Out("v"),
		Output("v"),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, ErrDependency) {
		t.Fatalf("err = %v, want ErrDependency", err)
	}
}

func TestWrongSignatureCallableFails(t *testing.T) {
	r := mustBuild(t, "wrong-sig", Deps{"dep": func() {}}, Call("dep"))
	_, err := r.Run(context.Background())
	if !errors.Is(err, ErrDependency) {
		t.Fatalf("err = %v, want ErrDependency", err)
	}
}

func TestPresentPlainNilFailsOptionalIncluded(t *testing.T) {
	deps := Deps{"dep": nil}
	for _, def := range []Def{Call("dep"), Optional("dep")} {
		r := mustBuild(t, "plain-nil", deps, def)
		if _, err := r.Run(context.Background()); !errors.Is(err, ErrDependency) {
			t.Fatalf("def %T: err = %v, want ErrDependency", def, err)
		}
	}
}

func TestTypedNilConvertibleIsUnresolved(t *testing.T) {
	var fn StepFunc
	deps := Deps{"dep": fn}
	r := mustBuild(t, "typed-nil-opt", deps, Optional("dep").Out("v"))
	if out, err := r.Run(context.Background()); err != nil || out != nil {
		t.Fatalf("optional typed-nil: out=%v err=%v, want skip", out, err)
	}
	r2 := mustBuild(t, "typed-nil-call", deps, Call("dep"))
	if _, err := r2.Run(context.Background()); !errors.Is(err, ErrDependency) {
		t.Fatalf("call typed-nil: err = %v, want ErrDependency", err)
	}
}

func TestTypedNilOtherSignatureIsInvalid(t *testing.T) {
	var fn func()
	r := mustBuild(t, "typed-nil-other", Deps{"dep": fn}, Optional("dep"))
	if _, err := r.Run(context.Background()); !errors.Is(err, ErrDependency) {
		t.Fatalf("err = %v, want ErrDependency", err)
	}
}

func TestNilMapDepIsInvalid(t *testing.T) {
	var m map[string]any
	r := mustBuild(t, "nil-map", Deps{"dep": m}, Optional("dep"))
	if _, err := r.Run(context.Background()); !errors.Is(err, ErrDependency) {
		t.Fatalf("err = %v, want ErrDependency", err)
	}
}

func TestReservedOutputNameFailsAtMerge(t *testing.T) {
	r := mustBuild(t, "reserved", nil,
		Step("s", ret("v")).Out("next"),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, ErrOutputName) {
		t.Fatalf("err = %v, want ErrOutputName", err)
	}
	if !strings.Contains(err.Error(), "reserved") {
		t.Fatalf("message: %v", err)
	}
}

func TestDynamicMergeReservedNameFails(t *testing.T) {
	r := mustBuild(t, "merge-reserved", nil,
		Step("s", ret(map[string]any{"next": 1})).Out(Merge()),
	)
	if _, err := r.Run(context.Background()); !errors.Is(err, ErrOutputName) {
		t.Fatalf("err = %v, want ErrOutputName", err)
	}
}

func TestOutputShadowsLiveDependency(t *testing.T) {
	deps := Deps{"db": "conn"}
	r := mustBuild(t, "shadow", deps,
		Step("s", ret("mine")).Out("db"),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, ErrOutputName) {
		t.Fatalf("err = %v, want ErrOutputName", err)
	}
	if !strings.Contains(err.Error(), "shadows") {
		t.Fatalf("message: %v", err)
	}
}

func TestShadowCheckUsesLiveDeps(t *testing.T) {
	deps := Deps{}
	r := mustBuild(t, "live-shadow", deps,
		Step("s", ret("v")).Out("late"),
	)
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("before mutation: %v", err)
	}
	deps["late"] = "now-configured"
	if _, err := r.Run(context.Background()); !errors.Is(err, ErrOutputName) {
		t.Fatalf("after mutation: err = %v, want ErrOutputName", err)
	}
	delete(deps, "late")
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("after removal: %v", err)
	}
}

func TestInvocationInputsExemptFromShadowCheck(t *testing.T) {
	r := mustBuild(t, "input-shadow", Deps{"x": "dep"}, Input("x"), Output("x"))
	out, err := r.Run(context.Background(), "invoked")
	if err != nil || out != "invoked" {
		t.Fatalf("out=%v err=%v", out, err)
	}
}

func TestMergeValidationOrderArrayIndexesFirst(t *testing.T) {
	deps := Deps{"z": 1}
	r := mustBuild(t, "order", deps,
		Step("s", ret(map[string]any{"z": 1, "10": 1, "2": 1})).Out(Merge()),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, ErrOutputName) || !strings.Contains(err.Error(), `"z"`) {
		t.Fatalf("err = %v, want shadow error on z", err)
	}
}

func TestPickValidationOrderReportsArrayIndexesFirst(t *testing.T) {
	deps := Deps{"z": 1}
	r := mustBuild(t, "pick-order", deps,
		Step("s", ret(map[string]any{"b": "x", "a": "y", "z": "c"})).Out(Pick("b:2", "a:1", "z:z")),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, ErrOutputName) || !strings.Contains(err.Error(), `"z"`) {
		t.Fatalf("err = %v, want shadow error on z (index destinations 1 and 2 validate first, then the string key)", err)
	}
}

func TestFirstErrorWinsAndIsSticky(t *testing.T) {
	first := errors.New("first")
	second := errors.New("second")
	ran := false
	r := mustBuild(t, "sticky", nil,
		Step("a", retErr(nil, first)),
		Step("b", func(context.Context, []any) (any, error) {
			ran = true
			return nil, second
		}),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, first) || errors.Is(err, second) {
		t.Fatalf("err = %v, want first only", err)
	}
	if ran {
		t.Fatal("step after error executed")
	}
}

func TestFrameworkErrorsNeverRouteToHandler(t *testing.T) {
	handlerRan := false
	r := mustBuild(t, "fw", nil,
		Step("s", ret(map[string]any{"next": 1})).Out(Merge()),
		Error("h", func(context.Context, []any) error {
			handlerRan = true
			return nil
		}),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, ErrOutputName) {
		t.Fatalf("err = %v, want ErrOutputName", err)
	}
	if handlerRan {
		t.Fatal("handler ran for a framework error")
	}
}

func TestStepErrorRoutesToHandlerWithOriginalError(t *testing.T) {
	boom := errors.New("boom")
	var got error
	r := mustBuild(t, "route", nil,
		Step("s", retErr(nil, boom)),
		Error("h", func(_ context.Context, args []any) error {
			got = args[0].(error)
			return nil
		}),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want boom", err)
	}
	if got != boom {
		t.Fatalf("handler saw %v, want the original error object", got)
	}
	if err.Error() == boom.Error() {
		t.Fatalf("Run returned the bare error; want the context wrapper: %v", err)
	}
}

func TestHandlerDefaultInputIsTheActiveError(t *testing.T) {
	boom := errors.New("boom")
	var got any
	r := mustBuild(t, "default-input", nil,
		Step("s", retErr(nil, boom)),
		Error("h", func(_ context.Context, args []any) error {
			if len(args) != 1 {
				t.Fatalf("args = %#v", args)
			}
			got = args[0]
			return nil
		}),
	)
	if _, err := r.Run(context.Background()); !errors.Is(err, boom) {
		t.Fatalf("Run: %v, want the active error returned alongside the handler run", err)
	}
	if got != boom {
		t.Fatalf("got = %v, want boom", got)
	}
}

func TestHandlerFailureJoinsSettlement(t *testing.T) {
	boom := errors.New("boom")
	dlq := errors.New("dlq write failed")
	r := mustBuild(t, "join", nil,
		Step("s", retErr(nil, boom)),
		Error("h", func(context.Context, []any) error { return dlq }),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want boom joined", err)
	}
	if !errors.Is(err, dlq) {
		t.Fatalf("err = %v, want dlq joined", err)
	}
}

func TestErrorCallResolvesFromPreSnapshotContainer(t *testing.T) {
	boom := errors.New("boom")
	fromContainer := errors.New("from-container")
	r := mustBuild(t, "errorcall", nil,
		Step("produce", ret(func(_ context.Context, _ []any) error { return fromContainer })).Out("error"),
		Step("fail", retErr(nil, boom)),
		ErrorCall("error"),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, boom) {
		t.Fatalf("err = %v, want boom", err)
	}
	if !strings.Contains(err.Error(), "from-container") {
		t.Fatalf("err = %v, want the container-resolved handler's failure joined", err)
	}
}

func TestErrorCallLookupFailureJoins(t *testing.T) {
	boom := errors.New("boom")
	r := mustBuild(t, "errorcall-missing", nil,
		Step("s", retErr(nil, boom)),
		ErrorCall("missing"),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, boom) || !errors.Is(err, ErrDependency) {
		t.Fatalf("err = %v, want boom joined with ErrDependency", err)
	}
}

func TestPanicRecoveredAndRouted(t *testing.T) {
	r := mustBuild(t, "panic", nil,
		Step("s", func(context.Context, []any) (any, error) { panic("boom") }),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, ErrPanicked) {
		t.Fatalf("err = %v, want ErrPanicked", err)
	}
	if !strings.Contains(err.Error(), "boom") {
		t.Fatalf("message: %v", err)
	}
}

func TestPanicWithErrorRoutesAsItself(t *testing.T) {
	boom := errors.New("boom")
	r := mustBuild(t, "panic-err", nil,
		Step("s", func(context.Context, []any) (any, error) { panic(boom) }),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, boom) || errors.Is(err, ErrPanicked) {
		t.Fatalf("err = %v, want boom without ErrPanicked", err)
	}
}

func TestHandlerPanicJoinsSettlement(t *testing.T) {
	boom := errors.New("boom")
	r := mustBuild(t, "handler-panic", nil,
		Step("s", retErr(nil, boom)),
		Error("h", func(context.Context, []any) error { panic("handler died") }),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, boom) || !errors.Is(err, ErrPanicked) {
		t.Fatalf("err = %v, want boom joined with ErrPanicked", err)
	}
}

func TestErrorWithValueProducesBeforeRouting(t *testing.T) {
	boom := errors.New("boom")
	r := mustBuild(t, "value-and-err", nil,
		Step("s", retErr(map[string]any{"a": 1}, boom)).Out(Pick("a")),
		Error("h", func(_ context.Context, args []any) error {
			m := args[0].(map[string]any)
			if m["a"] != 1 {
				t.Errorf("snapshot[a] = %v, want 1", m["a"])
			}
			return nil
		}).InFields("a"),
	)
	if _, err := r.Run(context.Background()); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want boom", err)
	}
}

func TestOutputNameViolationInPartialBeatsReturnedError(t *testing.T) {
	boom := errors.New("boom")
	r := mustBuild(t, "partial-beats", nil,
		Step("s", retErr(map[string]any{"next": 1}, boom)).Out(Merge()),
	)
	_, err := r.Run(context.Background())
	if !errors.Is(err, ErrOutputName) || errors.Is(err, boom) {
		t.Fatalf("err = %v, want ErrOutputName only", err)
	}
}

func TestNilResultOnAnyError(t *testing.T) {
	r := mustBuild(t, "nil-result", nil,
		Step("s", ret("partial")).Out("a"),
		Step("f", retErr(nil, errors.New("boom"))),
		Output("a"),
	)
	out, err := r.Run(context.Background())
	if err == nil || out != nil {
		t.Fatalf("out=%v err=%v, want nil result with error", out, err)
	}
}

func TestHaltSettlesSuccessfullyWithPartialSnapshot(t *testing.T) {
	ran := false
	r := mustBuild(t, "halt", nil,
		Step("first", ret("kept")).Out("a"),
		Not("gate"),
		Step("after", func(context.Context, []any) (any, error) {
			ran = true
			return nil, nil
		}),
		Output("a"),
	)
	deps := Deps{"gate": false}
	r2, err := Build("halt", deps, r.steps[0], Not("gate"), r.steps[1], Output("a"))
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	out, err := r2.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "kept" || ran {
		t.Fatalf("out=%v ran=%v, want kept and no later step", out, ran)
	}
}
