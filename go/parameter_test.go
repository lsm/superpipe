package superpipe

import (
	"context"
	"errors"
	"testing"
)

func ret(v any) StepFunc {
	return func(context.Context, []any) (any, error) { return v, nil }
}

func retErr(v any, err error) StepFunc {
	return func(context.Context, []any) (any, error) { return v, err }
}

func runStep(t *testing.T, spec any, value any, outDef Def) (any, error) {
	t.Helper()
	r := mustBuild(t, "param", nil,
		Step("s", func(context.Context, []any) (any, error) { return value, nil }).Out(spec),
		outDef,
	)
	return r.Run(context.Background())
}

func TestOutBindsWholeValue(t *testing.T) {
	out, err := runStep(t, "user", "u", Output("user"))
	if err != nil || out != "u" {
		t.Fatalf("out=%v err=%v", out, err)
	}
}

func TestOutNilReturnCreatesNoBindingsAndPriorPersists(t *testing.T) {
	r := mustBuild(t, "nil-out", nil,
		Step("first", ret("kept")).Out("a"),
		Step("second", ret(nil)).Out("a"),
		Output("a"),
	)
	out, err := r.Run(context.Background())
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "kept" {
		t.Fatalf("out = %v, want kept (prior binding persists)", out)
	}
}

func TestRenameIsOneKeyPick(t *testing.T) {
	out, err := runStep(t, Rename("src", "dst"), map[string]any{"src": 1}, OutputFields("dst"))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	m, ok := out.(map[string]any)
	if !ok || m["dst"] != 1 || len(m) != 1 {
		t.Fatalf("out = %#v, want map[dst:1]", out)
	}

	_, err = runStep(t, Rename("src", "dst"), map[string]any{"other": 1}, Output("dst"))
	if !errors.Is(err, ErrOutputKey) {
		t.Fatalf("err = %v, want ErrOutputKey", err)
	}
}

func TestPickMissingKeyThrows(t *testing.T) {
	_, err := runStep(t, Pick("a", "b"), map[string]any{"a": 1}, OutputFields("a", "b"))
	if !errors.Is(err, ErrOutputKey) {
		t.Fatalf("err = %v, want ErrOutputKey", err)
	}
}

func TestPickScalarReturnThrows(t *testing.T) {
	_, err := runStep(t, Pick("a"), 42, Output("a"))
	if !errors.Is(err, ErrOutputKey) {
		t.Fatalf("err = %v, want ErrOutputKey", err)
	}
}

func TestPickRenameSpelling(t *testing.T) {
	out, err := runStep(t, Pick("a:x", "b:y"), map[string]any{"a": 1, "b": 2}, OutputFields("x", "y"))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	m := out.(map[string]any)
	if m["x"] != 1 || m["y"] != 2 {
		t.Fatalf("out = %#v", out)
	}
}

func TestPickLiteralMultiColonKey(t *testing.T) {
	out, err := runStep(t, Pick("a:b:c"), map[string]any{"a:b:c": 7}, OutputFields("a:b:c"))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out.(map[string]any)["a:b:c"] != 7 {
		t.Fatalf("out = %#v", out)
	}
}

func TestPickDuplicateDestinationLastWriteWins(t *testing.T) {
	out, err := runStep(t, Pick("a:x", "b:x"), map[string]any{"a": 1, "b": 2}, OutputFields("x"))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out.(map[string]any)["x"] != 2 {
		t.Fatalf("out = %#v, want x from b", out)
	}
}

func TestPickNilReturnThrowsValueRequirement(t *testing.T) {
	_, err := runStep(t, Pick("a"), nil, Output("a"))
	if !errors.Is(err, ErrOutputKey) {
		t.Fatalf("err = %v, want ErrOutputKey", err)
	}
}

func TestDestructureArrayPositional(t *testing.T) {
	out, err := runStep(t, Destructure("a", "b"), []any{1, 2}, OutputFields("a", "b"))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	m := out.(map[string]any)
	if m["a"] != 1 || m["b"] != 2 {
		t.Fatalf("out = %#v", out)
	}
}

func TestDestructureShortArrayThrows(t *testing.T) {
	_, err := runStep(t, Destructure("a", "b"), []any{1}, Output("a"))
	if !errors.Is(err, ErrOutputKey) {
		t.Fatalf("err = %v, want ErrOutputKey", err)
	}
}

func TestDestructureMapPicksByName(t *testing.T) {
	out, err := runStep(t, Destructure("a"), map[string]any{"a": 9, "z": 1}, OutputFields("a"))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	m := out.(map[string]any)
	if m["a"] != 9 || len(m) != 1 {
		t.Fatalf("out = %#v", out)
	}
}

func TestMergeRequiresMap(t *testing.T) {
	if _, err := runStep(t, Merge(), map[string]any{"a": 1}, Output("a")); err != nil {
		t.Fatalf("map return: %v", err)
	}
	if _, err := runStep(t, Merge(), []any{1}, Output("a")); !errors.Is(err, ErrOutputKey) {
		t.Fatalf("array return err = %v, want ErrOutputKey", err)
	}
	if _, err := runStep(t, Merge(), 3, Output("a")); !errors.Is(err, ErrOutputKey) {
		t.Fatalf("scalar return err = %v, want ErrOutputKey", err)
	}
}

func TestMergeTypedMapsAccepted(t *testing.T) {
	type myMap map[string]int
	out, err := runStep(t, Merge(), myMap{"a": 1}, Output("a"))
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != 1 {
		t.Fatalf("out = %#v, want 1", out)
	}
}

func TestErrorPathLeniencyBindsAvailableEntries(t *testing.T) {
	boom := errors.New("boom")
	r := mustBuild(t, "lenient", nil,
		Step("s", retErr(map[string]any{"a": 1}, boom)).Out(Pick("a", "b")),
		Error("h", func(_ context.Context, args []any) error {
			if len(args) != 1 {
				t.Fatalf("handler input = %#v, want single map", args)
			}
			m, ok := args[0].(map[string]any)
			if !ok {
				t.Fatalf("handler input = %#v, want map", args[0])
			}
			if m["a"] != 1 {
				t.Errorf("snapshot[a] = %v, want 1", m["a"])
			}
			v, present := m["b"]
			if !present || v != nil {
				t.Errorf("snapshot[b] = %v present=%v, want present-with-nil", v, present)
			}
			return nil
		}).InFields("a", "b"),
	)
	if _, err := r.Run(context.Background()); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want boom", err)
	}
}

func TestErrorPathStructurallyIncompatibleYieldsNoBindings(t *testing.T) {
	boom := errors.New("boom")
	r := mustBuild(t, "incompatible", nil,
		Step("s", retErr(42, boom)).Out(Pick("a")),
		Error("h", func(_ context.Context, args []any) error {
			m := args[0].(map[string]any)
			if _, present := m["a"]; present {
				t.Errorf("snapshot[a] bound on incompatible return")
			}
			return nil
		}),
	)
	if _, err := r.Run(context.Background()); !errors.Is(err, boom) {
		t.Fatalf("err = %v, want boom", err)
	}
}

func TestValueRequirementAppliesToAllPickingForms(t *testing.T) {
	boom := errors.New("boom")
	for _, spec := range []any{Rename("a", "b"), Pick("a"), Destructure("a"), Merge()} {
		r := mustBuild(t, "req", nil, Step("s", ret(nil)).Out(spec))
		if _, err := r.Run(context.Background()); !errors.Is(err, ErrOutputKey) {
			t.Fatalf("spec %T: err = %v, want ErrOutputKey", spec, err)
		}
	}
	r := mustBuild(t, "req-ok", nil,
		Step("s", ret(nil)).Out("a"),
		Step("none", ret(nil)),
	)
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("no-value with single/none specs: err = %v, want success", err)
	}
	_ = boom
}

func TestTypedNilReturnIsNoValue(t *testing.T) {
	var nilMap map[string]any
	r := mustBuild(t, "typed-nil", nil,
		Step("s", ret(nilMap)).Out(Merge()),
	)
	if _, err := r.Run(context.Background()); !errors.Is(err, ErrOutputKey) {
		t.Fatalf("err = %v, want ErrOutputKey", err)
	}

	var nilPtr *struct{ X int }
	r2 := mustBuild(t, "typed-nil-prior", nil,
		Step("first", ret("kept")).Out("a"),
		Step("second", ret(nilPtr)).Out("a"),
		Output("a"),
	)
	out, err := r2.Run(context.Background())
	if err != nil || out != "kept" {
		t.Fatalf("out=%v err=%v, want kept", out, err)
	}
}

func TestInputFromObjectBindsRequestedNames(t *testing.T) {
	r := mustBuild(t, "ifo", nil,
		InputFromObject("a", "b"),
		Step("s", func(_ context.Context, args []any) (any, error) { return args[0], nil }).InFields("a", "b").Out("m"),
		Output("m"),
	)
	out, err := r.Run(context.Background(), map[string]any{"a": 1, "b": 2})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	m := out.(map[string]any)
	if m["a"] != 1 || m["b"] != 2 {
		t.Fatalf("out = %#v", out)
	}
}

func TestInputFromObjectMissingKeyBindsPresentWithNil(t *testing.T) {
	r := mustBuild(t, "ifo-missing", nil,
		InputFromObject("a", "z"),
		Step("s", func(_ context.Context, args []any) (any, error) { return args[0], nil }).InFields("a", "z").Out("m"),
		Output("m"),
	)
	out, err := r.Run(context.Background(), map[string]any{"a": 1})
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	m := out.(map[string]any)
	if m["a"] != 1 {
		t.Fatalf("a = %v", m["a"])
	}
	v, present := m["z"]
	if !present || v != nil {
		t.Fatalf("z = %v present=%v, want present-with-nil", v, present)
	}
}

func TestInputFromObjectNonMapSourceBindsNil(t *testing.T) {
	for _, source := range []any{42, struct{ X int }{1}, (*int)(nil), map[string]any(nil), []any(nil)} {
		r := mustBuild(t, "ifo-scalar", nil,
			InputFromObject("a"),
			Step("s", func(_ context.Context, args []any) (any, error) { return args[0], nil }).InFields("a").Out("m"),
			Output("m"),
		)
		out, err := r.Run(context.Background(), source)
		if err != nil {
			t.Fatalf("source %T: %v", source, err)
		}
		v, present := out.(map[string]any)["a"]
		if !present || v != nil {
			t.Fatalf("source %T: a = %v present=%v, want present-with-nil", source, v, present)
		}
	}
}

func TestInputFromObjectIndexedSources(t *testing.T) {
	type arr [3]string
	cases := []struct {
		source any
		key    string
		want   any
	}{
		{[]any{10, 20}, "1", 20},
		{[]any{10}, "5", nil},
		{arr{"a", "b", "c"}, "2", "c"},
		{[]any{1, 2}, "length", 2},
		{"héllo", "1", "é"},
		{"abc", "length", 3},
		{"abc", "01", nil},
		{[]any{1}, "4294967295", nil},
		{[]any{1}, "0", 1},
	}
	for _, c := range cases {
		r := mustBuild(t, "ifo-idx", nil,
			InputFromObject(c.key),
			Step("s", func(_ context.Context, args []any) (any, error) { return args[0], nil }).InFields(c.key).Out("m"),
			Output("m"),
		)
		out, err := r.Run(context.Background(), c.source)
		if err != nil {
			t.Fatalf("key %q source %T: %v", c.key, c.source, err)
		}
		got := out.(map[string]any)[c.key]
		if got != c.want {
			t.Fatalf("key %q source %T: got %#v want %#v", c.key, c.source, got, c.want)
		}
	}
}

func TestInFieldsDeliversOneMapArgument(t *testing.T) {
	r := mustBuild(t, "infields", nil,
		Input("a", "b"),
		Step("s", func(_ context.Context, args []any) (any, error) {
			if len(args) != 1 {
				t.Fatalf("args = %#v, want single map", args)
			}
			return args[0], nil
		}).InFields("a", "b").Out("m"),
		Output("m"),
	)
	out, err := r.Run(context.Background(), 1, 2)
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	m := out.(map[string]any)
	if m["a"] != 1 || m["b"] != 2 {
		t.Fatalf("out = %#v", out)
	}
}

func TestFreshArgsPerStep(t *testing.T) {
	var first, second []any
	r := mustBuild(t, "fresh", nil,
		Step("a", func(_ context.Context, args []any) (any, error) {
			first = args
			args[0] = "mutated"
			return nil, nil
		}),
		Step("b", func(_ context.Context, args []any) (any, error) {
			second = args
			return nil, nil
		}),
	)
	if _, err := r.Run(context.Background(), "orig"); err != nil {
		t.Fatalf("Run: %v", err)
	}
	if first[0] != "mutated" || second[0] != "orig" {
		t.Fatalf("first=%v second=%v, want mutation local to the first step's slice", first, second)
	}
}

func TestZeroInvocationArgsDeliverNonNilEmptySlice(t *testing.T) {
	r := mustBuild(t, "zero-args", nil,
		Step("s", func(_ context.Context, args []any) (any, error) {
			if args == nil {
				t.Fatal("args is nil, want non-nil empty slice")
			}
			if len(args) != 0 {
				t.Fatalf("args = %#v, want empty", args)
			}
			return nil, nil
		}),
	)
	if _, err := r.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
}
