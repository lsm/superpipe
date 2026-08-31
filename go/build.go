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
			errs := clone.validate()
			if seenStep {
				errs = append(errs, newInvalidDefinitionError("superpipe: input def must come before the first step"))
			}
			if len(errs) == 0 {
				r.inputs = append(r.inputs, clone)
			}
			violations = append(violations, errs...)

		case *StepDef:
			if d == nil {
				continue
			}
			clone := d.clone()
			errs := append(clone.validate(), validateSpec(clone.out)...)
			if seenHandler {
				errs = append(errs, newInvalidDefinitionError("superpipe: step %q follows the error handler", clone.name))
			}
			seenStep = true
			if len(errs) == 0 {
				r.steps = append(r.steps, clone)
			}
			violations = append(violations, errs...)

		case *ErrorDef:
			if d == nil {
				continue
			}
			clone := d.clone()
			errs := clone.validate()
			if seenHandler {
				errs = append(errs, newInvalidDefinitionError("superpipe: each pipeline may have only one error handler"))
			}
			seenHandler = true
			if len(errs) == 0 {
				r.handler = clone
			}
			violations = append(violations, errs...)

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
		if errs := lastOutput.validate(); len(errs) > 0 {
			violations = append(violations, errs...)
		} else {
			r.output = lastOutput.clone()
		}
	}

	if len(violations) > 0 {
		return nil, errors.Join(violations...)
	}
	return r, nil
}
