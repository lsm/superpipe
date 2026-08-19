#!/usr/bin/env node
// Ported from lsm/HyperNeo scripts/strip-comments.ts. Strips every line,
// block, and JSDoc comment from tracked .ts sources; --check exits
// non-zero when any remain (CI). Functional directives are exempt:
// shebangs, /// <reference>, @ts-*, lint pragmas, coverage ignores.
// HyperNeo drives the TypeScript scanner API; superpipe's typescript 7
// (native port) ships no compiler API, so this port lexes by hand —
// string/template/regex-aware, so nothing inside a literal is touched.

import { execSync } from 'node:child_process'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const KEEP_PATTERNS = [
  /^#!/,
  /^\/\/\/\s*</,
  /@ts-(ignore|expect-error|nocheck|check)\b/,
  /biome-ignore/,
  /\beslint\b/,
  /oxlint-(disable|enable)/,
  /@public\b/,
  /(v8|istanbul|c8) ignore/,
  /knip-ignore/,
]

// A `/` divides only after a token that can end an expression; everywhere
// else it opens a regex literal. Division after `)` is ambiguous (grouping
// vs. an if/while condition), so parens track whether they were opened
// after a control keyword: control parens leave regex eligible, others
// end the expression. Any regex candidate that fails to close on the same
// line is a lex failure — never silently reinterpreted, since the wrong
// guess here deletes code.
const REGEX_KEYWORDS = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'case',
  'default',
  'delete',
  'void',
  'new',
  'do',
  'else',
  'yield',
  'await',
  'throw',
])
const CONTROL_PAREN_KEYWORDS = new Set(['if', 'while', 'for', 'with', 'switch', 'catch'])
const ENDERS = new Set([
  'str-end',
  'tpl-end',
  're-end',
  'paren-end',
  ']',
  'prop-name',
  'postfix!',
  'postfix-op',
])

const isEnder = (token) =>
  ENDERS.has(token) ||
  (token !== '' && /^[A-Za-z_$0-9]+$/.test(token) && !REGEX_KEYWORDS.has(token))

function collectCommentRanges(text, literalSpans) {
  const ranges = []
  let lastSignificant = ''
  const stack = []
  let i = 0
  const n = text.length

  while (i < n) {
    const top = stack[stack.length - 1]
    const ch = text[i]
    const next = text[i + 1]

    // Template text: everything is literal until ` or ${ — comments and
    // quotes here are data, never code.
    if (top !== undefined && top.type === 'tpl') {
      if (ch === '\\') {
        i += 2
      } else if (ch === '`') {
        const frame = stack.pop()
        literalSpans?.push({ start: frame.start, end: i + 1 })
        lastSignificant = 'tpl-end'
        i++
      } else if (ch === '$' && next === '{') {
        stack.push({ type: 'expr', depth: 0 })
        lastSignificant = '{'
        i += 2
      } else {
        i++
      }
      continue
    }

    if (ch === '/' && next === '/') {
      let j = i + 2
      while (j < n && text[j] !== '\n') j++
      const comment = text.slice(i, j)
      if (!KEEP_PATTERNS.some((p) => p.test(comment))) ranges.push({ start: i, end: j })
      i = j
      continue
    }
    if (ch === '/' && next === '*') {
      const j = text.indexOf('*/', i + 2)
      if (j === -1) {
        const line = text.slice(0, i).split('\n').length
        throw new Error(
          `line ${line}: block comment is never closed — ambiguous lex, refusing to strip`,
        )
      }
      const end = j + 2
      if (!KEEP_PATTERNS.some((p) => p.test(text.slice(i, end)))) ranges.push({ start: i, end })
      i = end
      continue
    }
    if (ch === '/' && !isEnder(lastSignificant)) {
      // Regex literal: skip to its unescaped close, minding char classes.
      let j = i + 1
      let inClass = false
      while (j < n) {
        if (text[j] === '\\') j++
        else if (text[j] === '[') inClass = true
        else if (text[j] === ']') inClass = false
        else if (text[j] === '/' && !inClass) break
        else if (text[j] === '\n') break
        j++
      }
      if (text[j] !== '/') {
        const line = text.slice(0, i).split('\n').length
        throw new Error(
          `line ${line}: '/' does not close a pattern on the same line — ambiguous lex, refusing to strip`,
        )
      }
      i = j + 1
      lastSignificant = 're-end'
      continue
    }
    if (ch === "'" || ch === '"') {
      let j = i + 1
      while (j < n) {
        if (text[j] === '\\') j++
        else if (text[j] === ch || text[j] === '\n') break
        j++
      }
      literalSpans?.push({ start: i, end: Math.min(j + 1, n) })
      lastSignificant = 'str-end'
      i = j + 1
      continue
    }
    if (ch === '`') {
      stack.push({ type: 'tpl', start: i })
      i++
      continue
    }
    if (ch === '{') {
      if (top !== undefined) top.depth++
      lastSignificant = '{'
      i++
      continue
    }
    if (ch === '}') {
      if (top !== undefined && top.type === 'expr' && --top.depth < 0) {
        stack.pop()
        lastSignificant = 'tpl-end'
      } else {
        lastSignificant = '}'
      }
      i++
      continue
    }
    if (/[A-Za-z_$0-9]/.test(ch)) {
      let j = i
      while (j < n && /[A-Za-z_$0-9]/.test(text[j])) j++
      lastSignificant = lastSignificant === '.' ? 'prop-name' : text.slice(i, j)
      i = j
      continue
    }
    if (ch === '!') {
      lastSignificant = isEnder(lastSignificant) ? 'postfix!' : '!'
      i++
      continue
    }
    if ((ch === '+' || ch === '-') && next === ch) {
      // Postfix ++/-- ends the expression and divides afterwards; prefix
      // keeps regex eligible.
      lastSignificant = isEnder(lastSignificant) ? 'postfix-op' : ch
      i += 2
      continue
    }
    if (ch === '(') {
      stack.push({ type: 'paren', control: CONTROL_PAREN_KEYWORDS.has(lastSignificant) })
      lastSignificant = '('
      i++
      continue
    }
    if (ch === ')') {
      const top = stack[stack.length - 1]
      if (top !== undefined && top.type === 'paren') {
        stack.pop()
        lastSignificant = top.control ? ')' : 'paren-end'
      } else {
        lastSignificant = 'paren-end'
      }
      i++
      continue
    }
    if (!/\s/.test(ch)) lastSignificant = ch
    i++
  }
  return ranges
}

function expandRange(text, { start, end }) {
  let lineStart = 0
  if (start > 0) {
    const nl = text.lastIndexOf('\n', start - 1)
    lineStart = nl === -1 ? 0 : nl + 1
  }
  let nlAfter = text.indexOf('\n', end)
  if (nlAfter === -1) nlAfter = text.length
  const prefix = text.slice(lineStart, start)
  const suffix = text.slice(end, nlAfter)
  if (/^\s*$/.test(prefix) && /^\s*$/.test(suffix)) {
    return { start: lineStart, end: Math.min(nlAfter + 1, text.length) }
  }
  let e = end
  while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++
  return { start, end: e }
}

function mergeRanges(ranges) {
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) {
      last.end = Math.max(last.end, r.end)
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

const tidy = (segment) => segment.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n')

function normalizeOutsideLiterals(text) {
  const spans = []
  collectCommentRanges(text, spans)
  let out = ''
  let cursor = 0
  for (const { start, end } of mergeRanges(spans)) {
    out += tidy(text.slice(cursor, start))
    out += text.slice(start, end)
    cursor = end
  }
  return out + tidy(text.slice(cursor))
}

export function stripComments(text) {
  const comments = collectCommentRanges(text)
  if (comments.length === 0) return text
  const removals = mergeRanges(comments.map((r) => expandRange(text, r)))
  let out = ''
  let cursor = 0
  for (const { start, end } of removals) {
    out += text.slice(cursor, start)
    cursor = end
  }
  out += text.slice(cursor)
  return normalizeOutsideLiterals(out)
}

function main() {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const stats = args.includes('--stats')
  const filesIdx = args.indexOf('--files')

  let files
  if (filesIdx !== -1) {
    files = args.slice(filesIdx + 1).filter((a) => !a.startsWith('--'))
  } else {
    files = execSync("git ls-files '*.ts'", { encoding: 'utf8' })
      .split('\n')
      .map((f) => f.trim())
      .filter(Boolean)
  }

  let dirty = 0
  let removed = 0
  let failed = false
  for (const file of files) {
    const text = readFileSync(file, 'utf8')
    let stripped
    try {
      stripped = stripComments(text)
    } catch (err) {
      process.stdout.write(`cannot lex ${file}: ${err.message}\n`)
      failed = true
      break
    }
    if (stripped === text) continue
    dirty++
    const count = collectCommentRanges(text).length
    removed += count
    if (stats) process.stdout.write(`${file}: ${count}\n`)
    if (check) {
      process.stdout.write(`comments remain: ${file}\n`)
    } else {
      writeFileSync(file, stripped)
    }
  }
  process.stdout.write(
    `${check ? 'files with comments' : 'files stripped'}: ${dirty}, comments removed: ${removed}\n`,
  )
  if (failed) process.exit(2)
  if (check && dirty > 0) process.exit(1)
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  main()
}
