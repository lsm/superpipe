package superpipe

type Outcome interface {
	result() (any, bool)
}

type valueResult struct {
	value any
}

func (r valueResult) result() (any, bool) { return r.value, false }

type reasonResult struct {
	reason any
}

func (r reasonResult) result() (any, bool) { return r.reason, true }

func Value[T any](value T) Outcome { return valueResult{value: value} }

func Reason[T any](reason T) Outcome { return reasonResult{reason: reason} }
