package superpipe

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"runtime"
	"slices"
	"strconv"
)

type runState struct {
	container map[string]any
	args      []any
}

func (r *Runner) lookup(container map[string]any, name string) any {
	if v, ok := container[name]; ok {
		return v
	}
	return r.deps[name]
}

func (r *Runner) present(container map[string]any, name string) bool {
	if _, ok := container[name]; ok {
		return true
	}
	_, ok := r.deps[name]
	return ok
}

type fnKind int

const (
	fnKindCallable fnKind = iota
	fnKindBool
	fnKindAbsent
	fnKindPlainNil
	fnKindTypedNil
	fnKindInvalid
)

var (
	stepFuncType     = reflect.TypeFor[StepFunc]()
	errorHandlerType = reflect.TypeFor[ErrorHandlerFunc]()
)

func asStepFunc(v any) (StepFunc, bool) {
	rv := reflect.ValueOf(v)
	if !rv.IsValid() || rv.Kind() != reflect.Func || !rv.Type().ConvertibleTo(stepFuncType) {
		return nil, false
	}
	fn, _ := rv.Convert(stepFuncType).Interface().(StepFunc)
	return fn, fn != nil
}

func asErrorHandler(v any) (ErrorHandlerFunc, bool) {
	if v == nil {
		return nil, false
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Func || !rv.Type().ConvertibleTo(errorHandlerType) {
		return nil, false
	}
	fn, _ := rv.Convert(errorHandlerType).Interface().(ErrorHandlerFunc)
	return fn, fn != nil
}

func (r *Runner) resolveStep(d *StepDef, container map[string]any) (StepFunc, bool, fnKind) {
	if !d.injected {
		return d.fn, false, fnKindCallable
	}
	v := r.lookup(container, d.depName)
	if v == nil {
		if r.present(container, d.depName) {
			return nil, false, fnKindPlainNil
		}
		return nil, false, fnKindAbsent
	}
	if b, ok := asBool(v); ok {
		return nil, b, fnKindBool
	}
	if fn, ok := asStepFunc(v); ok {
		return fn, false, fnKindCallable
	}
	if rv := reflect.ValueOf(v); rv.Kind() == reflect.Func && rv.IsNil() && rv.Type().ConvertibleTo(stepFuncType) {
		return nil, false, fnKindTypedNil
	}
	return nil, false, fnKindInvalid
}

func abortError(ctx context.Context) error {
	reason := any(context.Cause(ctx))
	if reason == nil {
		reason = ctx.Err()
	}
	return &AbortedError{Reason: reason}
}

func (r *Runner) Run(ctx context.Context, args ...any) (any, error) {
	if err := ctx.Err(); err != nil {
		return nil, abortError(ctx)
	}
	st := &runState{container: map[string]any{}, args: args}
	if st.args == nil {
		st.args = []any{}
	}

	for _, ip := range r.inputs {
		entries := r.produceInput(ip, st.args)
		if err := r.mergeEntries(st, entries, true, -1, "input"); err != nil {
			return nil, err
		}
	}

	for i, sd := range r.steps {
		if err := ctx.Err(); err != nil {
			return nil, abortError(ctx)
		}
		halted, err := r.executeStep(ctx, st, i, sd)
		if err != nil {
			return nil, err
		}
		if halted {
			if cerr := ctx.Err(); cerr != nil {
				return nil, abortError(ctx)
			}
			return r.fetchOutput(st), nil
		}
	}

	if err := ctx.Err(); err != nil {
		return nil, abortError(ctx)
	}
	return r.fetchOutput(st), nil
}

func (r *Runner) stepArgs(st *runState, d *StepDef) []any {
	if !d.inSet {
		fresh := make([]any, len(st.args))
		copy(fresh, st.args)
		return fresh
	}
	if len(d.inFields) > 0 {
		m := make(map[string]any, len(d.inFields))
		for _, name := range d.inFields {
			m[name] = r.lookup(st.container, name)
		}
		return []any{m}
	}
	out := make([]any, len(d.in))
	for i, name := range d.in {
		out[i] = r.lookup(st.container, name)
	}
	return out
}

func (r *Runner) hasUnresolvedInput(st *runState, d *StepDef) bool {
	names := d.in
	if len(d.inFields) > 0 {
		names = d.inFields
	}
	for _, name := range names {
		if !r.present(st.container, name) {
			return true
		}
	}
	return false
}

func convertPanic(what string, rec any) error {
	if rec == nil {
		return fmt.Errorf("superpipe: %s panicked with nil: %w", what, ErrPanicked)
	}
	if err, ok := rec.(error); ok {
		if _, isNil := rec.(*runtime.PanicNilError); isNil {
			return fmt.Errorf("superpipe: %s panicked with nil: %w", what, ErrPanicked)
		}
		return err
	}
	return fmt.Errorf("superpipe: %s panicked with value %v: %w", what, rec, ErrPanicked)
}

func invokeStep(ctx context.Context, stepName string, fn StepFunc, args []any) (value any, err error) {
	done := false
	func() {
		defer func() {
			if !done {
				err = convertPanic(fmt.Sprintf("step %q", stepName), recover())
			}
		}()
		value, err = fn(ctx, args)
		done = true
	}()
	return value, err
}

// asBool treats any value of underlying boolean kind as a bool, so defined
// types like type Gate bool participate in flow control like plain bool.
func asBool(v any) (bool, bool) {
	if v == nil {
		return false, false
	}
	rv := reflect.ValueOf(v)
	if rv.Kind() != reflect.Bool {
		return false, false
	}
	return rv.Bool(), true
}

func isNoValue(v any) bool {
	if v == nil {
		return true
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Pointer, reflect.UnsafePointer, reflect.Map, reflect.Slice, reflect.Chan, reflect.Func:
		return rv.IsNil()
	default:
		return false
	}
}

func (r *Runner) executeStep(ctx context.Context, st *runState, idx int, d *StepDef) (halted bool, err error) {
	fn, boolVal, kind := r.resolveStep(d, st.container)

	if d.optional {
		if kind == fnKindAbsent || kind == fnKindTypedNil || r.hasUnresolvedInput(st, d) {
			return false, nil
		}
	}

	switch kind {
	case fnKindAbsent:
		return false, newDependencyError("superpipe: pipeline %q step %d %q: dependency %q is not a valid step function", r.name, idx, d.name, d.depName)
	case fnKindPlainNil, fnKindInvalid, fnKindTypedNil:
		return false, newDependencyError("superpipe: pipeline %q step %d %q: dependency %q is not a valid step function", r.name, idx, d.name, d.depName)
	}

	spec := d.out
	if spec == nil {
		spec = noneSpec{}
	}

	var value any
	var stepErr error
	isFlowControl := d.not || kind == fnKindBool

	if kind == fnKindBool {
		value = boolVal
	} else {
		value, stepErr = invokeStep(ctx, d.name, fn, r.stepArgs(st, d))
	}

	if cerr := ctx.Err(); cerr != nil {
		return false, abortError(ctx)
	}

	if d.not {
		if b, ok := asBool(value); ok {
			value = !b
		}
	}

	if stepErr == nil && isFlowControl {
		if b, ok := asBool(value); ok && !b {
			return true, nil
		}
	}

	if stepErr != nil {
		if !isNoValue(value) {
			entries, ferr := spec.produce(value, true)
			if ferr != nil {
				return false, ferr
			}
			if merr := r.mergeEntries(st, entries, false, idx, d.name); merr != nil {
				return false, merr
			}
		}
		return false, r.settleError(ctx, st, idx, d.name, stepErr)
	}

	if isNoValue(value) {
		if spec.requiresValue() {
			return false, newOutputKeyError("superpipe: pipeline %q step %d %q: output spec requires the step to return a value, but it returned none", r.name, idx, d.name)
		}
		return false, nil
	}

	entries, ferr := spec.produce(value, false)
	if ferr != nil {
		return false, ferr
	}
	if merr := r.mergeEntries(st, entries, false, idx, d.name); merr != nil {
		return false, merr
	}
	return false, nil
}

func (r *Runner) settleError(ctx context.Context, st *runState, idx int, stepName string, activeErr error) error {
	// Framework errors are definition errors: they propagate as themselves,
	// never wrapped, and never route to the error handler — including one
	// returned by a step (a nested runner's failure, for example).
	if isFrameworkError(activeErr) {
		return activeErr
	}
	settlement := fmt.Errorf("superpipe: pipeline %q step %d %q: %w", r.name, idx, stepName, activeErr)
	if r.handler == nil {
		return settlement
	}

	hctx := context.WithoutCancel(ctx)
	var handlerErr error
	if r.handler.injected {
		v := r.lookup(st.container, r.handler.depName)
		fn, ok := asErrorHandler(v)
		if !ok {
			handlerErr = newDependencyError("superpipe: pipeline %q: error handler dependency %q is not a valid error handler", r.name, r.handler.depName)
		} else {
			handlerErr = r.invokeHandler(hctx, st, fn, activeErr)
		}
	} else {
		handlerErr = r.invokeHandler(hctx, st, r.handler.fn, activeErr)
	}

	if handlerErr != nil {
		return errors.Join(settlement, handlerErr)
	}
	return settlement
}

func (r *Runner) invokeHandler(ctx context.Context, st *runState, fn ErrorHandlerFunc, activeErr error) error {
	snapshot := make(map[string]any, len(st.container)+1)
	for k, v := range st.container {
		snapshot[k] = v
	}
	snapshot["error"] = activeErr

	h := r.handler
	var args []any
	switch {
	case !h.inSet:
		args = []any{activeErr}
	case len(h.inFields) > 0:
		m := make(map[string]any, len(h.inFields))
		for _, name := range h.inFields {
			m[name] = r.lookup(snapshot, name)
		}
		args = []any{m}
	default:
		args = make([]any, len(h.in))
		for i, name := range h.in {
			args[i] = r.lookup(snapshot, name)
		}
	}

	done := false
	var err error
	func() {
		defer func() {
			if !done {
				err = convertPanic(fmt.Sprintf("error handler %q", h.name), recover())
			}
		}()
		err = fn(ctx, args)
		done = true
	}()
	return err
}

// canonicalDigits reports whether key is the canonical decimal spelling of
// a number (digits only, no leading zeros) and its value; values too large
// for uint64 clamp to the maximum, which is beyond any collection length.
func canonicalDigits(key string) (uint64, bool) {
	if key == "" || (len(key) > 1 && key[0] == '0') {
		return 0, false
	}
	for i := 0; i < len(key); i++ {
		if key[i] < '0' || key[i] > '9' {
			return 0, false
		}
	}
	n, err := strconv.ParseUint(key, 10, 64)
	if err != nil {
		return ^uint64(0), true
	}
	return n, true
}

// canonicalIndex is the ECMAScript array-index test used for key ordering
// and slice/array element access: canonical digits, capped at 2^32−2.
// Larger spellings are ordinary string properties.
func canonicalIndex(key string) (uint64, bool) {
	n, ok := canonicalDigits(key)
	if !ok || n > 4294967294 {
		return 0, false
	}
	return n, true
}

// orderedEntryIndices follows ECMAScript Object.keys: canonical array-index
// keys ascending first, then the remaining keys in their given order.
func orderedEntryIndices(entries []entry) []int {
	indexKeys := make([]int, 0, len(entries))
	rest := make([]int, 0, len(entries))
	for i, e := range entries {
		if _, ok := canonicalIndex(e.key); ok {
			indexKeys = append(indexKeys, i)
		} else {
			rest = append(rest, i)
		}
	}
	slices.SortStableFunc(indexKeys, func(a, b int) int {
		ka, _ := canonicalIndex(entries[a].key)
		kb, _ := canonicalIndex(entries[b].key)
		switch {
		case ka < kb:
			return -1
		case ka > kb:
			return 1
		default:
			return 0
		}
	})
	return append(indexKeys, rest...)
}

func (r *Runner) mergeEntries(st *runState, entries []entry, isInvocationInput bool, step int, fnName string) error {
	for _, i := range orderedEntryIndices(entries) {
		e := entries[i]
		if e.key == "next" {
			return newOutputNameError("superpipe: pipeline %q step [%d|%s]: output name %q is reserved", r.name, step, fnName, e.key)
		}
		if !isInvocationInput {
			if _, shadow := r.deps[e.key]; shadow {
				return newOutputNameError("superpipe: pipeline %q step [%d|%s]: output name %q shadows a configured dependency of the same name", r.name, step, fnName, e.key)
			}
		}
		st.container[e.key] = e.value
	}
	return nil
}

func (r *Runner) produceInput(ip *InputDef, args []any) []entry {
	entries := make([]entry, 0, len(ip.names))
	if ip.fromObject {
		var source any
		if len(args) > 0 {
			source = args[0]
		}
		// Prepare the source once per definition: converting the map (or
		// the rune slice) per requested name would cost O(k·n).
		read := memberReader(source)
		for _, name := range ip.names {
			entries = append(entries, entry{key: name, value: read(name)})
		}
		return entries
	}
	for i, name := range ip.names {
		var v any
		if i < len(args) {
			v = args[i]
		}
		entries = append(entries, entry{key: name, value: v})
	}
	return entries
}

func memberReader(source any) func(name string) any {
	if source == nil {
		return func(string) any { return nil }
	}
	if m, ok := asStringKeyedMap(source); ok {
		return func(name string) any { return m[name] }
	}
	if rv, ok := asArray(source); ok {
		return func(name string) any { return readArrayMember(rv, name) }
	}
	if rv := reflect.ValueOf(source); rv.Kind() == reflect.String {
		runes := []rune(rv.String())
		return func(name string) any { return readStringMember(runes, name) }
	}
	return func(string) any { return nil }
}

func readArrayMember(rv reflect.Value, name string) any {
	if name == "length" {
		return rv.Len()
	}
	// Compare in uint64 before narrowing: on 32-bit targets a large
	// canonical index overflows int and would satisfy a naive bound.
	if n, ok := canonicalIndex(name); ok && n < uint64(rv.Len()) {
		return rv.Index(int(n)).Interface()
	}
	return nil
}

func readStringMember(runes []rune, name string) any {
	if name == "length" {
		return len(runes)
	}
	// String positions carry no array-index ceiling: any canonical
	// index within the rune count binds, however large the spelling.
	if n, ok := canonicalDigits(name); ok && n < uint64(len(runes)) {
		return string(runes[n])
	}
	return nil
}

func (r *Runner) fetchOutput(st *runState) any {
	if r.output == nil {
		return nil
	}
	names := r.output.names
	if r.output.fields {
		m := make(map[string]any, len(names))
		for _, name := range names {
			m[name] = r.lookup(st.container, name)
		}
		return m
	}
	switch len(names) {
	case 0:
		return nil
	case 1:
		return r.lookup(st.container, names[0])
	default:
		out := make([]any, len(names))
		for i, name := range names {
			out[i] = r.lookup(st.container, name)
		}
		return out
	}
}
