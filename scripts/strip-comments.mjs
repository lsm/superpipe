#!/usr/bin/env node
// Ported from lsm/HyperNeo scripts/strip-comments.ts. Strips every line,
// block, and JSDoc comment from tracked .ts sources; --check exits
// non-zero when any remain (CI). Functional directives are exempt:
// shebangs, /// <reference>, @ts-*, lint pragmas, coverage ignores.
// Comment detection skips string, template, and regex literals as identified
// by the TypeScript parser (typescript 6, the JS compiler); every `//` or `/*`
// outside a literal is unambiguously a comment, so nothing inside a literal is
// ever touched and a comment is found regardless of which token it precedes.

import { execSync } from 'node:child_process'
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import ts from 'typescript6'

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

function parse(text, fileName) {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
}

function collectCommentRanges(text, fileName) {
  const spans = mergeRanges(collectLiteralSpans(text, fileName))
  const ranges = []
  let spanIdx = 0
  let i = 0
  const n = text.length
  while (i < n) {
    const span = spans[spanIdx]
    if (span && i >= span.end) {
      spanIdx++
      continue
    }
    if (span && i >= span.start) {
      i = span.end
      continue
    }
    if (text[i] === '/' && text[i + 1] === '/') {
      let j = i + 2
      while (j < n && text[j] !== '\n') j++
      if (!KEEP_PATTERNS.some((p) => p.test(text.slice(i, j)))) ranges.push({ start: i, end: j })
      i = j
      continue
    }
    if (text[i] === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2)
      if (close === -1) {
        const line = text.slice(0, i).split('\n').length
        throw new Error(
          `line ${line}: block comment is never closed — ambiguous lex, refusing to strip`,
        )
      }
      const end = close + 2
      if (!KEEP_PATTERNS.some((p) => p.test(text.slice(i, end)))) ranges.push({ start: i, end })
      i = end
      continue
    }
    i++
  }
  return ranges
}

function collectLiteralSpans(text, fileName) {
  const sf = parse(text, fileName)
  const spans = []
  const visit = (node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isRegularExpressionLiteral(node)
    ) {
      spans.push({ start: node.getStart(sf), end: node.end })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return spans
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

function normalizeOutsideLiterals(text, fileName) {
  const spans = mergeRanges(collectLiteralSpans(text, fileName))
  let out = ''
  let cursor = 0
  for (const { start, end } of spans) {
    out += tidy(text.slice(cursor, start))
    out += text.slice(start, end)
    cursor = end
  }
  return out + tidy(text.slice(cursor))
}

export function stripComments(text, fileName = 'x.ts') {
  const comments = collectCommentRanges(text, fileName)
  if (comments.length === 0) return text
  const removals = mergeRanges(comments.map((r) => expandRange(text, r)))
  let out = ''
  let cursor = 0
  for (const { start, end } of removals) {
    out += text.slice(cursor, start)
    cursor = end
  }
  out += text.slice(cursor)
  return normalizeOutsideLiterals(out, fileName)
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
      stripped = stripComments(text, file)
    } catch (err) {
      process.stdout.write(`cannot lex ${file}: ${err.message}\n`)
      failed = true
      break
    }
    if (stripped === text) continue
    dirty++
    const count = collectCommentRanges(text, file).length
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
