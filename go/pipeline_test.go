package superpipe

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func mustBuild(t *testing.T, name string, deps Deps, defs ...Def) *Runner {
	t.Helper()
	r, err := Build(name, deps, defs...)
	if err != nil {
		t.Fatalf("Build(%q): unexpected error: %v", name, err)
	}
	return r
}

func wantBuildError(t *testing.T, name string, deps Deps, defs ...Def) error {
	t.Helper()
	r, err := Build(name, deps, defs...)
	if err == nil {
		t.Fatalf("Build(%q): expected an error, got runner %v", name, r)
	}
	if !errors.Is(err, ErrInvalidDefinition) {
		t.Fatalf("Build(%q): error does not wrap ErrInvalidDefinition: %v", name, err)
	}
	return err
}

func TestBuildAcceptsValidDefinition(t *testing.T) {
	fetch := func(context.Context, []any) (any, error) { return "u", nil }
	r := mustBuild(t, "checkout", Deps{"isBlocked": false},
		Input("userId"),
		Step("fetchUser", fetch).In("userId").Out("user"),
		Not("isBlocked"),
		Output("user"),
	)
	out, err := r.Run(context.Background(), "u-1")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "u" {
		t.Fatalf("out = %v, want u", out)
	}
}

func TestInputDefsMustPrecedeSteps(t *testing.T) {
	step := Step("s", func(context.Context, []any) (any, error) { return 1, nil })
	err := wantBuildError(t, "late-input", nil, step, Input("x"))
	if !strings.Contains(err.Error(), "before the first step") {
		t.Fatalf("unexpected message: %v", err)
	}
}

func TestInputDefAfterErrorHandlerWithoutStepsIsAccepted(t *testing.T) {
	r := mustBuild(t, "input-after-error", nil,
		Error("h", func(context.Context, []any) error { return nil }),
		Input("x"),
	)
	if _, err := r.Run(context.Background(), 1); err != nil {
		t.Fatalf("Run: %v", err)
	}
}

func TestSecondErrorHandlerRejected(t *testing.T) {
	h := func(context.Context, []any) error { return nil }
	wantBuildError(t, "two-handlers", nil,
		Error("h1", h),
		Error("h2", h),
	)
}

func TestStepAfterErrorHandlerRejected(t *testing.T) {
	wantBuildError(t, "step-after-error", nil,
		Error("h", func(context.Context, []any) error { return nil }),
		Step("s", func(context.Context, []any) (any, error) { return 1, nil }),
	)
}

func TestMultipleInputDefsAccumulate(t *testing.T) {
	var seen []any
	r := mustBuild(t, "acc", nil,
		Input("a"),
		Input("b"),
		Step("s", func(_ context.Context, args []any) (any, error) {
			seen = args
			return nil, nil
		}).In("a", "b"),
	)
	if _, err := r.Run(context.Background(), 1, 2); err != nil {
		t.Fatalf("Run: %v", err)
	}
	// Each input def maps the invocation args positionally from the start,
	// matching the reference running inputPipes in order over the same args.
	if len(seen) != 2 || seen[0] != 1 || seen[1] != 1 {
		t.Fatalf("args = %v, want [1 1]", seen)
	}
}

func TestLaterInputDefWinsOnDuplicateName(t *testing.T) {
	r := mustBuild(t, "dup-input", nil,
		Input("x", "x"),
		Output("x"),
	)
	out, err := r.Run(context.Background(), "first", "second")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "second" {
		t.Fatalf("out = %v, want second", out)
	}
}

func TestDefinitionsAfterOutputDefStillExecute(t *testing.T) {
	r := mustBuild(t, "after-output", nil,
		Output("a"),
		Step("s2", func(context.Context, []any) (any, error) { return "b", nil }).Out("b"),
		Output("b"),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "b" {
		t.Fatalf("out = %v, want b", out)
	}
}

func TestRepeatedOutputDefLastWins(t *testing.T) {
	r := mustBuild(t, "last-output", nil,
		Step("s", func(context.Context, []any) (any, error) {
			return map[string]any{"a": 1, "b": 2}, nil
		}).Out(Pick("a", "b")),
		Output("a"),
		Output("b"),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != 2 {
		t.Fatalf("out = %v, want 2", out)
	}
}

func TestBareOutputResetsFinalOutput(t *testing.T) {
	r := mustBuild(t, "reset", nil,
		Step("s", func(context.Context, []any) (any, error) { return 1, nil }).Out("a"),
		Output("a"),
		Output(),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != nil {
		t.Fatalf("out = %v, want nil", out)
	}
}

func TestSupersededOutputIsNotValidated(t *testing.T) {
	r := mustBuild(t, "superseded", nil,
		Output("next"),
		Step("s", func(context.Context, []any) (any, error) { return 1, nil }).Out("a"),
		Output("a"),
	)
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
}

func TestEffectiveOutputNamingNextRejected(t *testing.T) {
	wantBuildError(t, "output-next", nil,
		Step("s", func(context.Context, []any) (any, error) { return 1, nil }).Out("a"),
		Output("next"),
	)
}

func TestEmptyOutputFieldsRejected(t *testing.T) {
	wantBuildError(t, "empty-fields", nil, OutputFields())
}

func TestOutputEmptyStringIsValidRawName(t *testing.T) {
	r := mustBuild(t, "raw-empty", nil,
		Step("s", func(context.Context, []any) (any, error) {
			return map[string]any{"": "v"}, nil
		}).Out(Merge()),
		Output(""),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "v" {
		t.Fatalf("out = %v, want v", out)
	}
}

func TestOutEmptyNameRejected(t *testing.T) {
	wantBuildError(t, "out-empty", nil,
		Step("s", func(context.Context, []any) (any, error) { return "v", nil }).Out(""),
	)
}

func TestNilStepFuncRejected(t *testing.T) {
	wantBuildError(t, "nil-fn", nil, Step("s", nil))
	wantBuildError(t, "nil-handler", nil, Error("h", nil))
}

func TestEmptyInputDefRejected(t *testing.T) {
	wantBuildError(t, "empty-input", nil, Input())
	wantBuildError(t, "empty-from-object", nil, InputFromObject())
}

func TestReservedStepInputNameRejected(t *testing.T) {
	wantBuildError(t, "in-next", nil,
		Step("s", func(context.Context, []any) (any, error) { return 1, nil }).In("next"),
	)
	wantBuildError(t, "error-in-next", nil,
		Error("h", func(context.Context, []any) error { return nil }).In("next"),
	)
}

func TestInputDefNamingNextIsDeferredToRun(t *testing.T) {
	r := mustBuild(t, "input-next", nil, Input("next"))
	_, err := r.Run(context.Background(), 1)
	if !errors.Is(err, ErrOutputName) {
		t.Fatalf("err = %v, want ErrOutputName", err)
	}
}

func TestInjectedNameNextRejected(t *testing.T) {
	wantBuildError(t, "call-next", nil, Call("next"))
	wantBuildError(t, "not-next", nil, Not("next"))
	wantBuildError(t, "optional-next", nil, Optional("next"))
	wantBuildError(t, "errorcall-next", nil, ErrorCall("next"))
}

func TestEmptyInjectedNamesFollowSigilRule(t *testing.T) {
	mustBuild(t, "not-empty", nil, Not(""))
	mustBuild(t, "optional-empty", nil, Optional(""))
	wantBuildError(t, "call-empty", nil, Call(""))
	wantBuildError(t, "errorcall-empty", nil, ErrorCall(""))
}

func TestSigilRoundTripValidation(t *testing.T) {
	mustBuild(t, "not-bang", nil, Not("!x"))
	mustBuild(t, "optional-q", nil, Optional("?x"))
	mustBuild(t, "optional-bang", nil, Optional("!x"))
	mustBuild(t, "optional-not-bang", nil, Optional(Not("!x")))
	mustBuild(t, "optional-not-q", nil, Optional(Not("?x")))
	wantBuildError(t, "call-bang", nil, Call("!x"))
	wantBuildError(t, "call-q", nil, Call("?x"))
	wantBuildError(t, "not-q", nil, Not("?x"))
}

func TestErrorCallExemptFromSigilRule(t *testing.T) {
	mustBuild(t, "errorcall-sigil", nil, ErrorCall("!x"))
}

func TestGrammarSensitiveOutNamesRejected(t *testing.T) {
	step := func() *StepDef { return Step("s", func(context.Context, []any) (any, error) { return nil, nil }) }
	wantBuildError(t, "out-rename", nil, step().Out("a:b"))
	wantBuildError(t, "out-objstring", nil, step().Out("{a}"))
	wantBuildError(t, "out-ellipsis", nil, step().Out("..."))
	mustBuild(t, "out-literal", nil, step().Out("a:b:c"))
	mustBuild(t, "out-literal2", nil, step().Out("a:"))
	mustBuild(t, "out-literal3", nil, step().Out("{a"))
}

func TestRenameOperandsMustBeColonFree(t *testing.T) {
	step := func() *StepDef { return Step("s", func(context.Context, []any) (any, error) { return nil, nil }) }
	wantBuildError(t, "rename-colon-src", nil, step().Out(Rename("a:b", "c")))
	wantBuildError(t, "rename-colon-dst", nil, step().Out(Rename("a", "b:c")))
	wantBuildError(t, "rename-ellipsis-dst", nil, step().Out(Rename("a", "...")))
	mustBuild(t, "rename-ellipsis-src", nil, step().Out(Rename("...", "x")))
}

func TestPickKeyGrammarRules(t *testing.T) {
	step := func() *StepDef { return Step("s", func(context.Context, []any) (any, error) { return nil, nil }) }
	wantBuildError(t, "pick-comma", nil, step().Out(Pick("a,b")))
	wantBuildError(t, "pick-space", nil, step().Out(Pick(" a")))
	wantBuildError(t, "pick-ellipsis", nil, step().Out(Pick("...")))
	wantBuildError(t, "pick-ellipsis-prefix", nil, step().Out(Pick("...x")))
	wantBuildError(t, "pick-empty", nil, step().Out(Pick("")))
	mustBuild(t, "pick-literal-multi-colon", nil, step().Out(Pick("a:b:c")))
	mustBuild(t, "pick-ellipsis-source", nil, step().Out(Pick("...:x")))
	mustBuild(t, "pick-objstring-member", nil, step().Out(Pick("{a}")))
}

func TestDestructureKeyGrammarRules(t *testing.T) {
	step := func() *StepDef { return Step("s", func(context.Context, []any) (any, error) { return nil, nil }) }
	wantBuildError(t, "destructure-objstring", nil, step().Out(Destructure("{a}")))
	wantBuildError(t, "destructure-ellipsis", nil, step().Out(Destructure("...")))
	mustBuild(t, "destructure-comma", nil, step().Out(Destructure("a,b")))
	mustBuild(t, "destructure-literal", nil, step().Out(Destructure("a:b:c")))
}

func TestObjectStringNameFormsRejected(t *testing.T) {
	wantBuildError(t, "input-objstring", nil, Input("{a}"))
	wantBuildError(t, "in-objstring", nil,
		Step("s", func(context.Context, []any) (any, error) { return nil, nil }).In("{a}"),
	)
	wantBuildError(t, "output-objstring", nil, Output("{a}"))
	wantBuildError(t, "infields-comma", nil,
		Step("s", func(context.Context, []any) (any, error) { return nil, nil }).InFields("a,b"),
	)
	wantBuildError(t, "fromobject-space", nil, InputFromObject(" a"))
}

func TestStandaloneRenameGrammarInputNameIsValid(t *testing.T) {
	r := mustBuild(t, "in-rename-literal", nil,
		Input("a:b"),
		Output("a:b"),
	)
	out, err := r.Run(context.Background(), "v")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "v" {
		t.Fatalf("out = %v, want v", out)
	}
}
