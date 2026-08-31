package superpipe

import (
	"errors"
	"fmt"
)

var (
	ErrOutputName        = errors.New("superpipe: invalid output name")
	ErrOutputKey         = errors.New("superpipe: output spec mismatch")
	ErrAborted           = errors.New("superpipe: pipeline aborted")
	ErrDependency        = errors.New("superpipe: dependency is not a valid step function")
	ErrInvalidDefinition = errors.New("superpipe: invalid pipeline definition")
	ErrPanicked          = errors.New("superpipe: panic recovered")
)

type AbortedError struct{ Reason any }

func (e *AbortedError) Error() string {
	if e.Reason == nil {
		return ErrAborted.Error()
	}
	return fmt.Sprintf("%s: %v", ErrAborted.Error(), e.Reason)
}

func (e *AbortedError) Unwrap() error { return ErrAborted }

type outputNameError struct{ msg string }

func (e *outputNameError) Error() string    { return e.msg }
func (e *outputNameError) Unwrap() error    { return ErrOutputName }
func (e *outputNameError) frameworkMarker() {}

type outputKeyError struct{ msg string }

func (e *outputKeyError) Error() string    { return e.msg }
func (e *outputKeyError) Unwrap() error    { return ErrOutputKey }
func (e *outputKeyError) frameworkMarker() {}

type dependencyError struct{ msg string }

func (e *dependencyError) Error() string    { return e.msg }
func (e *dependencyError) Unwrap() error    { return ErrDependency }
func (e *dependencyError) frameworkMarker() {}

type invalidDefinitionError struct{ msg string }

func (e *invalidDefinitionError) Error() string    { return e.msg }
func (e *invalidDefinitionError) Unwrap() error    { return ErrInvalidDefinition }
func (e *invalidDefinitionError) frameworkMarker() {}

type frameworkMarker interface{ frameworkMarker() }

func isFrameworkError(err error) bool {
	if err == nil {
		return false
	}
	var f frameworkMarker
	if errors.As(err, &f) {
		return true
	}
	var a *AbortedError
	return errors.As(err, &a)
}

func newOutputNameError(format string, args ...any) error {
	return &outputNameError{msg: fmt.Sprintf(format, args...)}
}

func newOutputKeyError(format string, args ...any) error {
	return &outputKeyError{msg: fmt.Sprintf(format, args...)}
}

func newDependencyError(format string, args ...any) error {
	return &dependencyError{msg: fmt.Sprintf(format, args...)}
}

func newInvalidDefinitionError(format string, args ...any) error {
	return &invalidDefinitionError{msg: fmt.Sprintf(format, args...)}
}
