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
	return pickSpec{keys: []specKey{{src: src, dst: dst, renamed: true}}}
}

func Pick(keys ...string) outputSpec {
	parsed := make([]specKey, len(keys))
	for i, k := range keys {
		parsed[i] = parseSpecKey(k)
	}
	return pickSpec{keys: parsed}
}

func Destructure(keys ...string) outputSpec {
	parsed := make([]specKey, len(keys))
	for i, k := range keys {
		parsed[i] = parseSpecKey(k)
	}
	return destructureSpec{keys: parsed}
}

func Merge() outputSpec { return spreadSpec{} }

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

func validateSpec(spec outputSpec) error {
	if spec == nil {
		return nil
	}
	switch s := spec.(type) {
	case noneSpec:
		return nil
	case singleSpec:
		if s.name == "" {
			return newInvalidDefinitionError("superpipe: output name must be non-empty")
		}
		if err := validateNameForm(s.name, "output name", formStandalone); err != nil {
			return err
		}
		if _, _, ok := splitRename(s.name); ok {
			return newInvalidDefinitionError("superpipe: output name %q matches the rename grammar; use Rename(%q, ...) for the pick form", s.name, s.name)
		}
		return validateEllipsisDst(s.name, "output name")
	case pickSpec:
		if len(s.keys) == 0 {
			return newInvalidDefinitionError("superpipe: pick spec requires at least one key")
		}
		for _, k := range s.keys {
			what := "pick key"
			if k.renamed {
				what = "rename operand"
				if strings.ContainsRune(k.src, ':') || strings.ContainsRune(k.dst, ':') {
					return newInvalidDefinitionError("superpipe: rename %q:%q contains a colon and would not re-parse as a rename", k.src, k.dst)
				}
			}
			if err := validateSpecKey(k, what, formObjectString); err != nil {
				return err
			}
		}
		return nil
	case destructureSpec:
		if len(s.keys) == 0 {
			return newInvalidDefinitionError("superpipe: destructure spec requires at least one key")
		}
		for _, k := range s.keys {
			what := "destructure key"
			if k.renamed {
				what = "rename operand"
				if strings.ContainsRune(k.src, ':') || strings.ContainsRune(k.dst, ':') {
					return newInvalidDefinitionError("superpipe: rename %q:%q contains a colon and would not re-parse as a rename", k.src, k.dst)
				}
			}
			if err := validateSpecKey(k, what, formArray); err != nil {
				return err
			}
		}
		return nil
	case spreadSpec:
		return nil
	default:
		return newInvalidDefinitionError("superpipe: unknown output spec %T", spec)
	}
}

func validateSpecKey(k specKey, what string, form int) error {
	if k.src == "" || k.dst == "" {
		return newInvalidDefinitionError("superpipe: %s must be non-empty", what)
	}
	if err := validateNameForm(k.src, what, form); err != nil {
		return err
	}
	if k.renamed {
		if err := validateNameForm(k.dst, what, form); err != nil {
			return err
		}
	}
	return validateEllipsisDst(k.dst, what)
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

func (d *StepDef) validate() error {
	if !d.injected && d.fn == nil {
		return newInvalidDefinitionError("superpipe: step %q has a nil function", d.name)
	}
	if d.injected {
		if d.depName == "next" {
			return newInvalidDefinitionError("superpipe: injected name %q is reserved", d.depName)
		}
		if d.depName == "" && !d.not && !d.optional {
			return newInvalidDefinitionError("superpipe: injected name must be non-empty")
		}
		if !sigilRoundTrip(d.depName, d.not, d.optional) {
			return newInvalidDefinitionError("superpipe: injected name %q with flags (not=%v, optional=%v) has no reference spelling", d.depName, d.not, d.optional)
		}
	}
	return validateInputs(d.in, d.inFields, d.inSet, fmt.Sprintf("step %q", d.name))
}

func validateInputs(in, inFields []string, inSet bool, what string) error {
	if !inSet {
		return nil
	}
	if len(in) == 0 && len(inFields) == 0 {
		return newInvalidDefinitionError("superpipe: %s declares an empty input list; omit the declaration to forward the invocation args", what)
	}
	if len(in) > 0 {
		form := formArray
		if len(in) == 1 {
			form = formStandalone
		}
		for _, name := range in {
			if name == "" {
				return newInvalidDefinitionError("superpipe: %s has an empty input name", what)
			}
			if name == "next" {
				return newInvalidDefinitionError("superpipe: %s declares the reserved input name %q", what, name)
			}
			if err := validateNameForm(name, "input name", form); err != nil {
				return err
			}
		}
		return nil
	}
	for _, name := range inFields {
		if name == "" {
			return newInvalidDefinitionError("superpipe: %s has an empty input field", what)
		}
		if name == "next" {
			return newInvalidDefinitionError("superpipe: %s declares the reserved input field %q", what, name)
		}
		if err := validateNameForm(name, "input field", formObjectString); err != nil {
			return err
		}
	}
	return nil
}

func (d *ErrorDef) validate() error {
	if !d.injected && d.fn == nil {
		return newInvalidDefinitionError("superpipe: error handler %q has a nil function", d.name)
	}
	if d.injected {
		if d.depName == "" {
			return newInvalidDefinitionError("superpipe: injected error handler name must be non-empty")
		}
		if d.depName == "next" {
			return newInvalidDefinitionError("superpipe: injected name %q is reserved", d.depName)
		}
	}
	return validateInputs(d.in, d.inFields, d.inSet, fmt.Sprintf("error handler %q", d.name))
}

func (d *InputDef) validate() error {
	if len(d.names) == 0 {
		return newInvalidDefinitionError("superpipe: input def requires at least one name")
	}
	form := formArray
	if d.fromObject {
		form = formObjectString
	} else if len(d.names) == 1 {
		form = formStandalone
	}
	for _, name := range d.names {
		if name == "" {
			return newInvalidDefinitionError("superpipe: input def has an empty name")
		}
		if err := validateNameForm(name, "input name", form); err != nil {
			return err
		}
	}
	return nil
}

func (d *OutputDef) validate() error {
	if d.fields {
		if len(d.names) == 0 {
			return newInvalidDefinitionError("superpipe: OutputFields requires at least one name")
		}
		for _, name := range d.names {
			if name == "" {
				return newInvalidDefinitionError("superpipe: OutputFields has an empty name")
			}
			if name == "next" {
				return newInvalidDefinitionError("superpipe: output name %q is reserved", name)
			}
			if err := validateNameForm(name, "output field", formObjectString); err != nil {
				return err
			}
		}
		return nil
	}
	if len(d.names) == 0 {
		return nil
	}
	if len(d.names) == 1 && d.names[0] == "" {
		return nil
	}
	for _, name := range d.names {
		if name == "" {
			return newInvalidDefinitionError("superpipe: Output has an empty name")
		}
		if name == "next" {
			return newInvalidDefinitionError("superpipe: output name %q is reserved", name)
		}
		if err := validateNameForm(name, "output name", formStandalone); err != nil {
			return err
		}
	}
	return nil
}
