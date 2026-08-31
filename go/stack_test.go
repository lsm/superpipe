package superpipe

import (
	"context"
	"testing"
)

func TestStackSafety100kSteps(t *testing.T) {
	const n = 100_000
	identity := func(_ context.Context, args []any) (any, error) { return args[0], nil }
	defs := make([]Def, 0, n+2)
	defs = append(defs, Input("v"))
	for i := 0; i < n; i++ {
		defs = append(defs, Step("identity", identity).In("v").Out("v"))
	}
	defs = append(defs, Output("v"))
	deep, err := Build("deep", nil, defs...)
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	out, err := deep.Run(context.Background(), "seed")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if out != "seed" {
		t.Fatalf("out = %v, want seed", out)
	}
}
