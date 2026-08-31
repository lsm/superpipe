package superpipe

import (
	"errors"
)

type Runner struct {
	name    string
	deps    Deps
	inputs  []*InputDef
	steps   []*StepDef
	handler *ErrorDef
	output  *OutputDef
}

// Build validates the definition list and returns an immutable *Runner.
// Every construction violation is reported together via errors.Join,
// each wrapping ErrInvalidDefinition. The runner retains deep copies of
// the accepted definitions; Deps stays live by reference per §5.
func Build(name string, deps Deps, defs ...Def) (*Runner, error) {
	r := &Runner{name: name, deps: deps}
	var violations []error

	seenStep := false
	seenHandler := false
	var lastOutput *OutputDef

	for _, def := range defs {
		switch d := def.(type) {
		case *InputDef:
			if d == nil {
				continue
			}
			clone := d.clone()
			ok := true
			if err := clone.validate(); err != nil {
				violations = append(violations, err)
				ok = false
			}
			if seenStep {
				violations = append(violations, newInvalidDefinitionError("superpipe: input def must come before the first step"))
				ok = false
			}
			if ok {
				r.inputs = append(r.inputs, clone)
			}

		case *StepDef:
			if d == nil {
				continue
			}
			clone := d.clone()
			ok := true
			if err := clone.validate(); err != nil {
				violations = append(violations, err)
				ok = false
			}
			if err := validateSpec(clone.out); err != nil {
				violations = append(violations, err)
				ok = false
			}
			if seenHandler {
				violations = append(violations, newInvalidDefinitionError("superpipe: step %q follows the error handler", clone.name))
				ok = false
			}
			seenStep = true
			if ok {
				r.steps = append(r.steps, clone)
			}

		case *ErrorDef:
			if d == nil {
				continue
			}
			clone := d.clone()
			ok := true
			if err := clone.validate(); err != nil {
				violations = append(violations, err)
				ok = false
			}
			if seenHandler {
				violations = append(violations, newInvalidDefinitionError("superpipe: each pipeline may have only one error handler"))
				ok = false
			}
			seenHandler = true
			if ok {
				r.handler = clone
			}

		case *OutputDef:
			if d == nil {
				continue
			}
			lastOutput = d

		default:
			violations = append(violations, newInvalidDefinitionError("superpipe: unknown definition %T", def))
		}
	}

	if lastOutput != nil {
		if err := lastOutput.validate(); err != nil {
			violations = append(violations, err)
		} else {
			r.output = lastOutput.clone()
		}
	}

	if len(violations) > 0 {
		return nil, errors.Join(violations...)
	}
	return r, nil
}
