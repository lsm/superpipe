package superpipe

import (
	"fmt"
	"reflect"
)

func Get[T any](args []any, i int) (T, error) {
	var zero T
	if i < 0 || i >= len(args) {
		return zero, fmt.Errorf("superpipe: Get: argument %d out of range (args has %d)", i, len(args))
	}
	v := args[i]
	if v == nil {
		if nilable[T]() {
			return zero, nil
		}
		return zero, fmt.Errorf("superpipe: Get: argument %d is nil, want %T", i, zero)
	}
	t, ok := v.(T)
	if !ok {
		return zero, fmt.Errorf("superpipe: Get: argument %d is %T, want %T", i, v, zero)
	}
	return t, nil
}

func nilable[T any]() bool {
	switch reflect.TypeFor[T]().Kind() {
	case reflect.Pointer, reflect.UnsafePointer, reflect.Map, reflect.Slice,
		reflect.Chan, reflect.Func, reflect.Interface:
		return true
	default:
		return false
	}
}
