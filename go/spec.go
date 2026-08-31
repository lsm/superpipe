package superpipe

import (
	"reflect"
	"sort"
	"strings"
)

type entry struct {
	key   string
	value any
}

type outputSpec interface {
	isOutputSpec()
	produce(value any, errorPath bool) ([]entry, error)
	requiresValue() bool
}

type specKey struct {
	src     string
	dst     string
	renamed bool
}

type noneSpec struct{}

type singleSpec struct{ name string }

type pickSpec struct{ keys []specKey }

type destructureSpec struct{ keys []specKey }

type spreadSpec struct{}

func (noneSpec) isOutputSpec()        {}
func (singleSpec) isOutputSpec()      {}
func (pickSpec) isOutputSpec()        {}
func (destructureSpec) isOutputSpec() {}
func (spreadSpec) isOutputSpec()      {}

func (noneSpec) requiresValue() bool        { return false }
func (singleSpec) requiresValue() bool      { return false }
func (pickSpec) requiresValue() bool        { return true }
func (destructureSpec) requiresValue() bool { return true }
func (spreadSpec) requiresValue() bool      { return true }

func parseSpecKey(s string) specKey {
	if src, dst, ok := splitRename(s); ok {
		return specKey{src: src, dst: dst, renamed: true}
	}
	return specKey{src: s, dst: s}
}

// splitRename mirrors RE_RENAME: exactly one colon with both sides non-empty.
func splitRename(s string) (string, string, bool) {
	i := strings.IndexByte(s, ':')
	if i <= 0 {
		return "", "", false
	}
	rest := s[i+1:]
	if rest == "" || strings.ContainsRune(rest, ':') {
		return "", "", false
	}
	return s[:i], rest, true
}

func (noneSpec) produce(any, bool) ([]entry, error) { return nil, nil }

func (s singleSpec) produce(value any, _ bool) ([]entry, error) {
	return []entry{{key: s.name, value: value}}, nil
}

func asStringKeyedMap(value any) (map[string]any, bool) {
	if value == nil {
		return nil, false
	}
	rv := reflect.ValueOf(value)
	if rv.Kind() != reflect.Map || rv.IsNil() {
		return nil, false
	}
	if rv.Type().Key().Kind() != reflect.String {
		return nil, false
	}
	out := make(map[string]any, rv.Len())
	iter := rv.MapRange()
	for iter.Next() {
		out[iter.Key().String()] = iter.Value().Interface()
	}
	return out, true
}

func (s pickSpec) produce(value any, errorPath bool) ([]entry, error) {
	m, ok := asStringKeyedMap(value)
	if !ok {
		if errorPath {
			return nil, nil
		}
		return nil, newOutputKeyError("superpipe: output spec %s picks properties, but the step returned %s", s.label(), kindOf(value))
	}
	entries := make([]entry, 0, len(s.keys))
	for _, k := range s.keys {
		if !errorPath {
			if _, present := m[k.src]; !present {
				return nil, newOutputKeyError("superpipe: output %q is missing from the step's returned object", k.src)
			}
		}
		entries = append(entries, entry{key: k.dst, value: m[k.src]})
	}
	return entries, nil
}

func (s pickSpec) label() string {
	parts := make([]string, len(s.keys))
	for i, k := range s.keys {
		parts[i] = k.src
		if k.renamed {
			parts[i] = k.src + ":" + k.dst
		}
	}
	return "{" + strings.Join(parts, ", ") + "}"
}

func (s destructureSpec) produce(value any, errorPath bool) ([]entry, error) {
	if arr, ok := asArray(value); ok {
		entries := make([]entry, 0, len(s.keys))
		for i, k := range s.keys {
			if !errorPath && i >= arr.Len() {
				return nil, newOutputKeyError("superpipe: output %q maps position %d, but the step's array return has %d element(s)", k.src, i, arr.Len())
			}
			var v any
			if i < arr.Len() {
				v = arr.Index(i).Interface()
			}
			entries = append(entries, entry{key: k.dst, value: v})
		}
		return entries, nil
	}
	if m, ok := asStringKeyedMap(value); ok {
		entries := make([]entry, 0, len(s.keys))
		for _, k := range s.keys {
			if !errorPath {
				if _, present := m[k.src]; !present {
					return nil, newOutputKeyError("superpipe: output %q is missing from the step's returned object", k.src)
				}
			}
			entries = append(entries, entry{key: k.dst, value: m[k.src]})
		}
		return entries, nil
	}
	if errorPath {
		return nil, nil
	}
	return nil, newOutputKeyError("superpipe: output spec %s destructures, but the step returned %s", s.label(), kindOf(value))
}

func (s destructureSpec) label() string {
	parts := make([]string, len(s.keys))
	for i, k := range s.keys {
		parts[i] = "'" + k.src + "'"
		if k.renamed {
			parts[i] = "'" + k.src + ":" + k.dst + "'"
		}
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func (spreadSpec) produce(value any, errorPath bool) ([]entry, error) {
	m, ok := asStringKeyedMap(value)
	if !ok {
		if errorPath {
			return nil, nil
		}
		return nil, newOutputKeyError(`superpipe: output spec "{...}" requires a plain map return, got %s`, kindOf(value))
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	entries := make([]entry, 0, len(keys))
	for _, k := range keys {
		entries = append(entries, entry{key: k, value: m[k]})
	}
	return entries, nil
}

func kindOf(value any) string {
	if value == nil {
		return "nil"
	}
	return reflect.TypeOf(value).Kind().String()
}

func asArray(value any) (reflect.Value, bool) {
	if value == nil {
		return reflect.Value{}, false
	}
	rv := reflect.ValueOf(value)
	switch rv.Kind() {
	case reflect.Slice:
		if rv.IsNil() {
			return reflect.Value{}, false
		}
		return rv, true
	case reflect.Array:
		return rv, true
	default:
		return reflect.Value{}, false
	}
}
