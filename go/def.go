package superpipe

import (
	"context"
	"fmt"
	"slices"
	"strings"
)

type StepFunc func(ctx context.Context, args []any) (any, error)

type ErrorHandlerFunc func(ctx context.Context, args []any) error

type Deps map[string]any

type Def interface{ isDef() }

type InputDef struct {
	names      []string
	fromObject bool
}

func (d *InputDef) isDef() {}

func (d *InputDef) clone() *InputDef {
	c := *d
	c.names = slices.Clone(d.names)
	return &c
}

func Input(names ...string) *InputDef {
	return &InputDef{names: names}
}

func InputFromObject(names ...string) *InputDef {
	return &InputDef{names: names, fromObject: true}
}

type StepDef struct {
	name     string
	fn       StepFunc
	depName  string
	injected bool
	not      bool
	optional bool
	in       []string
	inFields []string
	inSet    bool
	out      outputSpec
	outSet   bool
}

func (d *StepDef) isDef() {}

func cloneSpec(s outputSpec) outputSpec {
	switch v := s.(type) {
	case pickSpec:
		v.keys = slices.Clone(v.keys)
		return v
	case destructureSpec:
		v.keys = slices.Clone(v.keys)
		return v
	default:
		return s
	}
}

func (d *StepDef) clone() *StepDef {
	c := *d
	c.in = slices.Clone(d.in)
	c.inFields = slices.Clone(d.inFields)
	c.out = cloneSpec(d.out)
	return &c
}

func Step(name string, fn StepFunc) *StepDef {
	return &StepDef{name: name, fn: fn}
}

func Call(dep string) *StepDef {
	return &StepDef{name: dep, depName: dep, injected: true}
}

func Not(dep string) *StepDef {
	return &StepDef{name: dep, depName: dep, injected: true, not: true}
}

func Optional(dep any) *StepDef {
	switch v := dep.(type) {
	case string:
		return &StepDef{name: v, depName: v, injected: true, optional: true}
	case *StepDef:
		if v == nil || !v.not || v.optional || !v.injected {
			panic("superpipe: Optional accepts a dependency name or Not(name)")
		}
		cp := *v
		cp.optional = true
		return &cp
	default:
		panic("superpipe: Optional accepts a dependency name or Not(name)")
	}
}

func (d *StepDef) In(names ...string) *StepDef {
	d.in, d.inFields, d.inSet = names, nil, true
	return d
}

func (d *StepDef) InFields(names ...string) *StepDef {
	d.in, d.inFields, d.inSet = nil, names, true
	return d
}

func (d *StepDef) Out(spec any) *StepDef {
	switch v := spec.(type) {
	case string:
		d.out, d.outSet = singleSpec{name: v}, true
	case outputSpec:
		d.out, d.outSet = v, true
	default:
		panic("superpipe: Out accepts a name or a spec constructor (Rename, Pick, Destructure, Merge)")
	}
	return d
}

type ErrorDef struct {
	name     string
	fn       ErrorHandlerFunc
	depName  string
	injected bool
	in       []string
	inFields []string
	inSet    bool
}

func (d *ErrorDef) isDef() {}

func (d *ErrorDef) clone() *ErrorDef {
	c := *d
	c.in = slices.Clone(d.in)
	c.inFields = slices.Clone(d.inFields)
	return &c
}

func Error(name string, fn ErrorHandlerFunc) *ErrorDef {
	return &ErrorDef{name: name, fn: fn}
}

func ErrorCall(dep string) *ErrorDef {
	return &ErrorDef{name: dep, depName: dep, injected: true}
}

func (d *ErrorDef) In(names ...string) *ErrorDef {
	d.in, d.inFields, d.inSet = names, nil, true
	return d
}

func (d *ErrorDef) InFields(names ...string) *ErrorDef {
	d.in, d.inFields, d.inSet = nil, names, true
	return d
}

type OutputDef struct {
	names  []string
	fields bool
}

func (d *OutputDef) isDef() {}

func (d *OutputDef) clone() *OutputDef {
	c := *d
	c.names = slices.Clone(d.names)
	return &c
}

func Output(names ...string) *OutputDef {
	return &OutputDef{names: names}
}

func OutputFields(names ...string) *OutputDef {
	return &OutputDef{names: names, fields: true}
}

func Rename(src, dst string) outputSpec {
	return pickSpec{
		keys:          []specKey{{src: src, dst: dst, renamed: true}},
		serialization: formStandalone,
	}
}

func Pick(keys ...string) outputSpec {
	parsed := make([]specKey, len(keys))
	for i, k := range keys {
		parsed[i] = parseSpecKey(k)
	}
	return pickSpec{keys: parsed, serialization: formObjectString}
}

func Destructure(keys ...string) outputSpec {
	parsed := make([]specKey, len(keys))
	for i, k := range keys {
		parsed[i] = parseSpecKey(k)
	}
	return destructureSpec{keys: parsed}
}

func Merge() outputSpec { return spreadSpec{} }

func Result(name string) outputSpec { return resultSpec{name: name} }

const (
	formStandalone = iota
	formArray
	formObjectString
)

func isJSLineTerminator(r rune) bool {
	switch r {
	case '\n', '\r', 0x2028, 0x2029:
		return true
	}
	return false
}

func isJSTrimRune(r rune) bool {
	if isJSLineTerminator(r) {
		return true
	}
	switch r {
	case '\t', '\v', '\f', ' ', 0x00A0, 0x1680, 0x202F, 0x205F, 0x3000, 0xFEFF:
		return true
	}
	return r >= 0x2000 && r <= 0x200A
}

func hasJSLineTerminator(s string) bool {
	for _, r := range s {
		if isJSLineTerminator(r) {
			return true
		}
	}
	return false
}

// isObjectStringShape mirrors RE_IS_OBJ_STRING: "^{.+}$" without dotAll.
func isObjectStringShape(s string) bool {
	if len(s) < 3 || s[0] != '{' || s[len(s)-1] != '}' {
		return false
	}
	return !hasJSLineTerminator(s)
}

func validateNameForm(name, what string, form int) error {
	switch form {
	case formStandalone, formArray:
		if isObjectStringShape(name) {
			return newInvalidDefinitionError("superpipe: %s %q has the object-string shape and would be parsed as the object form by the reference", what, name)
		}
	case formObjectString:
		if strings.ContainsRune(name, ',') {
			return newInvalidDefinitionError("superpipe: %s %q contains a comma and would be re-split by the reference's object-string parsing", what, name)
		}
		if len(name) > 0 {
			runes := []rune(name)
			if isJSTrimRune(runes[0]) || isJSTrimRune(runes[len(runes)-1]) {
				return newInvalidDefinitionError("superpipe: %s %q has leading or trailing whitespace and would be trimmed by the reference's object-string parsing", what, name)
			}
		}
		if hasJSLineTerminator(name) {
			return newInvalidDefinitionError("superpipe: %s %q contains a line terminator and would break the reference's object-string form", what, name)
		}
	}
	return nil
}

func validateEllipsisDst(dst, what string) error {
	if strings.HasPrefix(dst, "...") {
		return newInvalidDefinitionError("superpipe: %s %q targets \"...\" which only works as the entire Merge() spec", what, dst)
	}
	return nil
}

func validateSpec(spec outputSpec) []error {
	if spec == nil {
		return nil
	}
	var errs []error
	switch s := spec.(type) {
	case noneSpec:
	case singleSpec:
		if s.name == "" {
			errs = append(errs, newInvalidDefinitionError("superpipe: output name must be non-empty"))
		}
		if err := validateNameForm(s.name, "output name", formStandalone); err != nil {
			errs = append(errs, err)
		}
		if _, _, ok := splitRename(s.name); ok {
			errs = append(errs, newInvalidDefinitionError("superpipe: output name %q matches the rename grammar; use Rename(%q, ...) for the pick form", s.name, s.name))
		}
		if err := validateEllipsisDst(s.name, "output name"); err != nil {
			errs = append(errs, err)
		}
	case pickSpec:
		if len(s.keys) == 0 {
			errs = append(errs, newInvalidDefinitionError("superpipe: pick spec requires at least one key"))
		}
		for _, k := range s.keys {
			errs = append(errs, validateSpecKey(k, "pick key", s.serialization)...)
		}
	case destructureSpec:
		if len(s.keys) == 0 {
			errs = append(errs, newInvalidDefinitionError("superpipe: destructure spec requires at least one key"))
		}
		for _, k := range s.keys {
			errs = append(errs, validateSpecKey(k, "destructure key", formArray)...)
		}
	case spreadSpec:
	case resultSpec:
		if s.name == "" {
			errs = append(errs, newInvalidDefinitionError("superpipe: result output name must be non-empty"))
		}
		if strings.ContainsRune(s.name, ':') {
			errs = append(errs, newInvalidDefinitionError("superpipe: result output name %q must not contain a colon", s.name))
		}
		if err := validateEllipsisDst(s.name, "result output name"); err != nil {
			errs = append(errs, err)
		}
	default:
		errs = append(errs, newInvalidDefinitionError("superpipe: unknown output spec %T", spec))
	}
	return errs
}

// validateSpecKey applies the serialization-form rule to the complete
// serialized key — "src:dst" for a rename, the key itself otherwise —
// because the reference parses the whole spelling, not the operands.
func validateSpecKey(k specKey, what string, form int) []error {
	var errs []error
	serialized := k.src
	if k.renamed {
		if k.src == "" || k.dst == "" {
			errs = append(errs, newInvalidDefinitionError("superpipe: %s must be non-empty", what))
		}
		if strings.ContainsRune(k.src, ':') || strings.ContainsRune(k.dst, ':') {
			errs = append(errs, newInvalidDefinitionError("superpipe: rename %q:%q contains a colon and would not re-parse as a rename", k.src, k.dst))
		}
		serialized = k.src + ":" + k.dst
	} else if k.src == "" {
		errs = append(errs, newInvalidDefinitionError("superpipe: %s must be non-empty", what))
	}
	if err := validateNameForm(serialized, what, form); err != nil {
		errs = append(errs, err)
	}
	if err := validateEllipsisDst(k.dst, what); err != nil {
		errs = append(errs, err)
	}
	return errs
}

func sigilRoundTrip(name string, not, optional bool) bool {
	s := ""
	if not {
		s += "!"
	}
	if optional {
		s += "?"
	}
	s += name
	var tsNot, tsOpt bool
	if strings.HasPrefix(s, "!") {
		tsNot = true
		s = s[1:]
	}
	if strings.HasPrefix(s, "?") {
		tsOpt = true
		s = s[1:]
	}
	return tsNot == not && tsOpt == optional && s == name
}

func (d *StepDef) validate() []error {
	var errs []error
	if !d.injected && d.fn == nil {
		errs = append(errs, newInvalidDefinitionError("superpipe: step %q has a nil function", d.name))
	}
	if d.injected {
		if d.depName == "next" {
			errs = append(errs, newInvalidDefinitionError("superpipe: injected name %q is reserved", d.depName))
		}
		if d.depName == "" && !d.not && !d.optional {
			errs = append(errs, newInvalidDefinitionError("superpipe: injected name must be non-empty"))
		}
		if !sigilRoundTrip(d.depName, d.not, d.optional) {
			errs = append(errs, newInvalidDefinitionError("superpipe: injected name %q with flags (not=%v, optional=%v) has no reference spelling", d.depName, d.not, d.optional))
		}
	}
	return append(errs, validateInputs(d.in, d.inFields, d.inSet, fmt.Sprintf("step %q", d.name))...)
}

func validateInputs(in, inFields []string, inSet bool, what string) []error {
	if !inSet {
		return nil
	}
	var errs []error
	if len(in) == 0 && len(inFields) == 0 {
		return append(errs, newInvalidDefinitionError("superpipe: %s declares an empty input list; omit the declaration to forward the invocation args", what))
	}
	if len(in) > 0 {
		form := formArray
		if len(in) == 1 {
			form = formStandalone
		}
		for _, name := range in {
			errs = append(errs, validateInputName(name, "input name", what, form)...)
		}
		return errs
	}
	for _, name := range inFields {
		errs = append(errs, validateInputName(name, "input field", what, formObjectString)...)
	}
	return errs
}

func validateInputName(name, kind, what string, form int) []error {
	var errs []error
	if name == "" {
		return append(errs, newInvalidDefinitionError("superpipe: %s has an empty %s", what, kind))
	}
	if name == "next" {
		errs = append(errs, newInvalidDefinitionError("superpipe: %s declares the reserved %s %q", what, kind, name))
	}
	if err := validateNameForm(name, kind, form); err != nil {
		errs = append(errs, err)
	}
	return errs
}

func (d *ErrorDef) validate() []error {
	var errs []error
	if !d.injected && d.fn == nil {
		errs = append(errs, newInvalidDefinitionError("superpipe: error handler %q has a nil function", d.name))
	}
	if d.injected {
		if d.depName == "" {
			errs = append(errs, newInvalidDefinitionError("superpipe: injected error handler name must be non-empty"))
		}
		if d.depName == "next" {
			errs = append(errs, newInvalidDefinitionError("superpipe: injected name %q is reserved", d.depName))
		}
	}
	return append(errs, validateInputs(d.in, d.inFields, d.inSet, fmt.Sprintf("error handler %q", d.name))...)
}

func (d *InputDef) validate() []error {
	var errs []error
	if len(d.names) == 0 {
		return append(errs, newInvalidDefinitionError("superpipe: input def requires at least one name"))
	}
	form := formArray
	if d.fromObject {
		form = formObjectString
	} else if len(d.names) == 1 {
		form = formStandalone
	}
	for _, name := range d.names {
		if name == "" {
			errs = append(errs, newInvalidDefinitionError("superpipe: input def has an empty name"))
			continue
		}
		if err := validateNameForm(name, "input name", form); err != nil {
			errs = append(errs, err)
		}
	}
	return errs
}

func (d *OutputDef) validate() []error {
	var errs []error
	if d.fields {
		if len(d.names) == 0 {
			return append(errs, newInvalidDefinitionError("superpipe: OutputFields requires at least one name"))
		}
		for _, name := range d.names {
			if name == "" {
				errs = append(errs, newInvalidDefinitionError("superpipe: OutputFields has an empty name"))
				continue
			}
			if name == "next" {
				errs = append(errs, newInvalidDefinitionError("superpipe: output name %q is reserved", name))
			}
			if err := validateNameForm(name, "output field", formObjectString); err != nil {
				errs = append(errs, err)
			}
		}
		return errs
	}
	if len(d.names) == 0 {
		return nil
	}
	if len(d.names) == 1 && d.names[0] == "" {
		return nil
	}
	for _, name := range d.names {
		if name == "" {
			errs = append(errs, newInvalidDefinitionError("superpipe: Output has an empty name"))
			continue
		}
		if name == "next" {
			errs = append(errs, newInvalidDefinitionError("superpipe: output name %q is reserved", name))
		}
		if err := validateNameForm(name, "output name", formStandalone); err != nil {
			errs = append(errs, err)
		}
	}
	return errs
}
