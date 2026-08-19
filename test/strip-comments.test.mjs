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

  it('still collapses blank runs left by comment removal in code', () => {
    const src = 'const a = 1\n// one\n// two\n// three\nconst b = 2\n'
    const out = stripComments(src, 'x.ts')
    expect(out).to.be.oneOf(['const a = 1\nconst b = 2\n', 'const a = 1\n\nconst b = 2\n'])
  })
})
