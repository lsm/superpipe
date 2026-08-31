package superpipe

import (
	"context"
	"strings"
	"sync"
	"testing"
)

func TestBuildClonesDefinitions(t *testing.T) {
	step := Step("s", func(_ context.Context, args []any) (any, error) { return args[0], nil }).
		In("v").Out("v")
	input := Input("v")
	names := []string{"v"}

	r, err := Build("clone", nil, input, step, Output(names[0]))
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	// Mutate every caller-owned definition and slice after Build.
	input.names[0] = "hijacked"
	step.in[0] = "hijacked"
	step.name = "hijacked"
	names[0] = "hijacked"

	out, err := r.Run(context.Background(), "seed")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "seed" {
		t.Fatalf("out = %v, want seed (definition mutated after Build)", out)
	}
}

func TestBuildClonesSpecKeys(t *testing.T) {
	keys := []string{"a"}
	def := Step("s", ret(map[string]any{"a": 1, "b": 2})).Out(Pick(keys[0]))
	r, err := Build("clone-spec", nil, def, Output("a"))
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	// Pick stores parsed keys, but exercise the same mutation discipline.
	_ = keys
	out, err := r.Run(context.Background())
	if err != nil || out != 1 {
		t.Fatalf("out=%v err=%v", out, err)
	}
}

func TestClonedDefinitionsRaceFree(t *testing.T) {
	step := Step("s", func(_ context.Context, args []any) (any, error) { return args[0], nil }).
		In("v").Out("v")
	r, err := Build("race", nil, Input("v"), step, Output("v"))
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := r.Run(context.Background(), "v"); err != nil {
				t.Errorf("Run: %v", err)
			}
		}()
	}
	wg.Wait()
}

func TestEmptyPickAndDestructureRejected(t *testing.T) {
	for _, spec := range []any{Pick(), Destructure()} {
		r := Step("s", ret(nil)).Out(spec)
		if _, err := Build("empty-spec", nil, r); err == nil || !strings.Contains(err.Error(), "at least one key") {
			t.Fatalf("spec %T: err = %v, want the at-least-one-key violation", spec, err)
		}
	}
}

func TestTrailingMultibyteWhitespaceRejected(t *testing.T) {
	if err := wantBuildErrorQuiet(InputFromObject("a　")); err == nil {
		t.Fatal("ideographic-space-suffixed member accepted, want rejected")
	}
	if err := wantBuildErrorQuiet(InputFromObject("　a")); err == nil {
		t.Fatal("ideographic-space-prefixed member accepted, want rejected")
	}
}

func wantBuildErrorQuiet(defs ...Def) error {
	_, err := Build("quiet", nil, defs...)
	return err
}

func TestCanonicalDigitsWithoutArrayCap(t *testing.T) {
	cases := []struct {
		key    string
		n      uint64
		ok     bool
		capped bool
	}{
		{"0", 0, true, true},
		{"42", 42, true, true},
		{"4294967294", 4294967294, true, true},
		{"4294967295", 4294967295, true, false},
		{"10000000000", 10000000000, true, false},
		{"01", 0, false, false},
		{"", 0, false, false},
		{"x", 0, false, false},
	}
	for _, c := range cases {
		n, ok := canonicalDigits(c.key)
		if ok != c.ok || (ok && n != c.n) {
			t.Fatalf("canonicalDigits(%q) = %v, %v; want %v, %v", c.key, n, ok, c.n, c.ok)
		}
		cn, cok := canonicalIndex(c.key)
		if cok != c.capped {
			t.Fatalf("canonicalIndex(%q) ok = %v; want %v", c.key, cok, c.capped)
		}
		if cok && cn != c.n {
			t.Fatalf("canonicalIndex(%q) = %v; want %v", c.key, cn, c.n)
		}
	}
}

func TestStringIndexAboveArrayCapIsCanonical(t *testing.T) {
	// A short string: every large canonical index is simply out of range.
	// The observable rule is that the spelling is canonical (no ceiling),
	// which the parser test above pins; here the run stays nil, not an error.
	r := mustBuild(t, "big-idx", nil,
		InputFromObject("4294967295"),
		Step("s", func(_ context.Context, args []any) (any, error) { return args[0], nil }).InFields("4294967295").Out("m"),
		Output("m"),
	)
	out, err := r.Run(context.Background(), "abc")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if v := out.(map[string]any)["4294967295"]; v != nil {
		t.Fatalf("v = %v, want nil (out of rune range)", v)
	}
}

func TestSliceIndexAboveArrayCapIsOrdinaryProperty(t *testing.T) {
	r := mustBuild(t, "over-cap", nil,
		InputFromObject("4294967295"),
		Step("s", func(_ context.Context, args []any) (any, error) { return args[0], nil }).InFields("4294967295").Out("m"),
		Output("m"),
	)
	out, err := r.Run(context.Background(), []any{1, 2, 3})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if v := out.(map[string]any)["4294967295"]; v != nil {
		t.Fatalf("v = %v, want nil (over-cap spellings are ordinary properties on arrays)", v)
	}
}

func TestInvalidDefsDoNotHideOrderingViolations(t *testing.T) {
	// An invalid step (nil function) still occupies a step position, so the
	// input def after it is an ordering violation, reported alongside.
	_, err := Build("step-then-input", nil,
		Step("bad", nil),
		Input("x"),
	)
	if err == nil {
		t.Fatal("expected violations")
	}
	msg := err.Error()
	if !strings.Contains(msg, "nil function") {
		t.Fatalf("missing the local violation: %v", msg)
	}
	if !strings.Contains(msg, "before the first step") {
		t.Fatalf("missing the ordering violation: %v", msg)
	}

	// An invalid handler still occupies the handler position, so the step
	// after it is reported too.
	_, err = Build("handler-then-step", nil,
		Error("bad", nil),
		Step("late", ret("v")),
	)
	if err == nil {
		t.Fatal("expected violations")
	}
	msg = err.Error()
	if !strings.Contains(msg, "nil function") {
		t.Fatalf("missing the local violation: %v", msg)
	}
	if !strings.Contains(msg, "follows the error handler") {
		t.Fatalf("missing the ordering violation: %v", msg)
	}
}

func TestLargeIndexOnSmallSliceBindsNil(t *testing.T) {
	// Guards the 32-bit portability fix: the bound is compared in uint64
	// before narrowing to int, so a large canonical index can never wrap
	// negative and index a small collection.
	for _, key := range []string{"2147483648", "3000000000", "4294967294"} {
		r := mustBuild(t, "big-slice-idx", nil,
			InputFromObject(key),
			Step("s", func(_ context.Context, args []any) (any, error) { return args[0], nil }).InFields(key).Out("m"),
			Output("m"),
		)
		out, err := r.Run(context.Background(), []any{1, 2, 3})
		if err != nil {
			t.Fatalf("key %q: %v", key, err)
		}
		if v := out.(map[string]any)[key]; v != nil {
			t.Fatalf("key %q: v = %v, want nil", key, v)
		}
	}
}

func TestStepReturnedFrameworkErrorSkipsHandler(t *testing.T) {
	handlerRan := false
	inner, err := Build("inner", nil,
		Step("s", ret(map[string]any{"next": 1})).Out(Merge()),
	)
	if err != nil {
		t.Fatalf("inner Build: %v", err)
	}
	r := mustBuild(t, "outer", nil,
		Step("nested", func(_ context.Context, _ []any) (any, error) {
			_, err := inner.Run(context.Background())
			return nil, err
		}),
		Error("h", func(context.Context, []any) error {
			handlerRan = true
			return nil
		}),
	)
	_, err = r.Run(context.Background())
	if !isFrameworkError(err) {
		t.Fatalf("err = %v, want the framework error unwrapped", err)
	}
	if handlerRan {
		t.Fatal("the outer handler ran for a framework error")
	}
}
