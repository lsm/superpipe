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
// each wrapping ErrInvalidDefinition.
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
			if err := d.validate(); err != nil {
				violations = append(violations, err)
				continue
			}
			if seenStep {
				violations = append(violations, newInvalidDefinitionError("superpipe: input def must come before the first step"))
				continue
			}
			r.inputs = append(r.inputs, d)

		case *StepDef:
			if d == nil {
				continue
			}
			if err := d.validate(); err != nil {
				violations = append(violations, err)
				continue
			}
			if err := validateSpec(d.out); err != nil {
				violations = append(violations, err)
				continue
			}
			if seenHandler {
				violations = append(violations, newInvalidDefinitionError("superpipe: step %q follows the error handler", d.name))
				continue
			}
			seenStep = true
			r.steps = append(r.steps, d)

		case *ErrorDef:
			if d == nil {
				continue
			}
			if err := d.validate(); err != nil {
				violations = append(violations, err)
				continue
			}
			if seenHandler {
				violations = append(violations, newInvalidDefinitionError("superpipe: each pipeline may have only one error handler"))
				continue
			}
			seenHandler = true
			r.handler = d

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
			r.output = lastOutput
		}
	}

	if len(violations) > 0 {
		return nil, errors.Join(violations...)
	}
	return r, nil
}
