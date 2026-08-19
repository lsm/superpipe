import { describe, expect, it } from 'vitest'
import { stripComments } from '../scripts/strip-comments.mjs'

describe('strip-comments lexer', () => {
  it('strips a comment after a regex following a return keyword', () => {
    // Review repro: the keyword list never matched because
    // lastSignificant held only one character, so the regex body was
    // lexed as code and the backtick inside it corrupted the lexer —
    // the trailing comment survived and --check false-passed.
    const src = 'function f(s){\n  return /`/.test(s)\n}\n// gone\nconst z = 1\n'
    const out = stripComments(src, 'x.ts')
    expect(out).to.not.contain('// gone')
    expect(out).to.contain('return /`/.test(s)')
    expect(out).to.contain('const z = 1')
  })

  it('treats regexes after other keywords as regexes', () => {
    const src = "const a = typeof /'/.test('x') // gone\nconst b = 1\n"
    const out = stripComments(src, 'x.ts')
    expect(out).to.not.contain('// gone')
    expect(out).to.contain("typeof /'/.test('x')")
  })

  it('treats a regex after the default keyword as a regex', () => {
    // Review repro: 'default' was absent from REGEX_KEYWORDS, so
    // `export default /[//]/` was read as division and the // inside the
    // character class deleted the rest of the line in write mode.
    const src = 'export default /[//]/\nkeep()\n'
    expect(stripComments(src, 'x.ts')).to.equal(src)
  })

  it('does not eat code after a regex containing slashes in a character class', () => {
    const src = 'const r = /[//]/.test(url) // gone\nkeep(r)\n'
    const out = stripComments(src, 'x.ts')
    expect(out).to.contain('/[//]/.test(url)')
    expect(out).to.contain('keep(r)')
    expect(out).to.not.contain('// gone')
  })

  it('keeps division after identifiers and string literals', () => {
    const src = "const n = total / count // gone\nconst m = 'a' / 2\n"
    const out = stripComments(src, 'x.ts')
    expect(out).to.contain('total / count')
    expect(out).to.contain("'a' / 2")
    expect(out).to.not.contain('// gone')
  })

  it('preserves multi-line template text verbatim around stripped comments', () => {
    // Review repro: the file-wide trailing-space and blank-line collapse
    // rewrote the template's own text, changing the runtime string.
    const src = 'const a = 1 // c\nconst t = `line   \nx\n\n\n\ny`\n'
    const out = stripComments(src, 'x.ts')
    expect(out).to.contain('`line   \nx\n\n\n\ny`')
    expect(out).to.not.contain('// c')
  })

  it('never deletes code from a regex following a control-paren close', () => {
    // Review repro: ')' was missing from the preceders, so the division
    // reading walked into /[//]/ and deleted to end of line — silent code
    // loss in write mode. Control parens (if/while/for) leave regex
    // eligible after their close.
    const src = 'if (x) /[//]/.test(y)\nkeep()\n'
    expect(stripComments(src, 'x.ts')).to.equal(src)
  })

  it('strips comments after a non-null assertion and property-name keywords', () => {
    // Review repro: postfix '!' and keywords used as property names
    // started bogus regex scans that swallowed the trailing comment.
    expect(stripComments('const x = a! / b // c\n', 'x.ts')).to.not.contain('// c')
    expect(stripComments('const x = obj.in / 2 // c\n', 'x.ts')).to.not.contain('// c')
  })

  it('divides after grouping and call parens', () => {
    expect(stripComments('const q = (a + b) / 2 // c\n', 'x.ts')).to.not.contain('// c')
    expect(stripComments('const q = f(x) / 2 // c\n', 'x.ts')).to.not.contain('// c')
  })

  it('leaves an unterminated regex untouched instead of misreading it as a comment', () => {
    // The parser tokenizes `/oops` as an (unterminated) regex literal, not a
    // comment, so stripping must leave the code intact rather than deleting
    // from the slash to end of line.
    expect(stripComments('const q = - /oops\n', 'x.ts')).to.equal('const q = - /oops\n')
  })

  it('still strips a real comment after an unterminated regex', () => {
    const out = stripComments('const q = - /oops\n// gone\nkeep()\n', 'x.ts')
    expect(out).to.not.contain('// gone')
    expect(out).to.contain('- /oops')
    expect(out).to.contain('keep()')
  })

  it('refuses to lex an unclosed block comment instead of erasing to EOF', () => {
    // Review repro: a block comment with no terminator was treated as
    // "runs to EOF" and the whole tail of the file was silently removed.
    expect(() => stripComments('const a = 1 /* oops\nkeep()\n', 'x.ts')).to.throw('never closed')
  })

  it('refuses a block comment whose closing slash overlaps the opener', () => {
    // `/*/` has no real `*/` terminator — the slash is the one after the
    // opening `/*` — so it must not be treated as a closed comment.
    expect(() => stripComments('const a = 1 /*/\nkeep()\n', 'x.ts')).to.throw('never closed')
  })

  it('divides after an object-literal closing brace', () => {
    // Review repro: `}` was not modelled as an expression ender, so
    // `{a:1} / 2` was read as a regex and the trailing comment survived.
    const out = stripComments('const x = {a:1} / 2 // c\n', 'x.ts')
    expect(out).to.not.contain('// c')
    expect(out).to.contain('{a:1} / 2')
  })

  it('does not treat template interpolation text as a comment', () => {
    // `// not a comment` sits inside `${...}`-interpolated template text;
    // the parser tokenizes it as a template tail, never a comment.
    const src = `const t = \`a\${1}b // not a comment\`\n`
    expect(stripComments(src, 'x.ts')).to.equal(src)
  })

  it('strips an inline block comment in the middle of an expression', () => {
    expect(stripComments('const x = /* inline */ 1\n', 'x.ts')).to.equal('const x = 1\n')
  })

  it('divides after a postfix increment or decrement', () => {
    // Review repro: ++/-- were not modelled as expression enders, so
    // 'i++ / 2' triggered the unterminated-pattern hard failure and
    // 'count++ / 2 // gone' silently left the comment behind.
    expect(stripComments('const x = i++ / 2\n', 'x.ts')).to.equal('const x = i++ / 2\n')
    expect(stripComments('const x = i-- / 2\n', 'x.ts')).to.equal('const x = i-- / 2\n')
    expect(stripComments('const half = count++ / 2 // gone\n', 'x.ts')).to.not.contain('// gone')
    expect(stripComments('const half = count-- / 2 // gone\n', 'x.ts')).to.not.contain('// gone')
  })

  it('still collapses blank runs left by comment removal in code', () => {
    const src = 'const a = 1\n// one\n// two\n// three\nconst b = 2\n'
    const out = stripComments(src, 'x.ts')
    expect(out).to.be.oneOf(['const a = 1\nconst b = 2\n', 'const a = 1\n\nconst b = 2\n'])
  })
})
