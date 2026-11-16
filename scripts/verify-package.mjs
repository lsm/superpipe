#!/usr/bin/env node
// End-to-end check of what a user installs: build, pack, install the tarball into a
// throwaway consumer project, then run and type-check it there. Also builds and runs a
// throwaway Go module that imports the Go port through a replace directive.
//
//   node scripts/verify-package.mjs            # build + pack + all surfaces
//   node scripts/verify-package.mjs --no-go    # skip the Go consumer
//   node scripts/verify-package.mjs --go-only  # only the Go consumer
//   node scripts/verify-package.mjs --skip-build   # reuse the current dist/
//   node scripts/verify-package.mjs --keep     # keep the consumer directory for inspection
//
// Exit code 0 only when every check passed; the last line prints the counts.

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Set(process.argv.slice(2))
const work = mkdtempSync(join(tmpdir(), 'superpipe-verify-'))
const results = []

function run(cmd, cmdArgs, cwd, env) {
  return execFileSync(cmd, cmdArgs, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  })
}

function check(name, fn) {
  try {
    const detail = fn()
    results.push({ name, ok: true })
    console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`)
  } catch (error) {
    results.push({ name, ok: false })
    const out = [error.stdout, error.stderr].filter(Boolean).join('\n').trim()
    console.log(`FAIL ${name} — ${out || error.message}`)
  }
}

// Runs inside each consumer surface. It receives the module namespace (ESM, CJS or the IIFE
// global) and returns a promise of a summary line, rejecting on the first mismatch.
async function smoke(ns) {
  const superpipe = ns.default
  const { PipelineAbortedError, typed } = ns
  const eq = (label, got, want) => {
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      throw new Error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`)
    }
  }
  const seen = []
  const sp = superpipe({ greet: (name) => `Hello, ${name}!`, isBlocked: false })

  sp('greeting-pipeline')
    .input(['name'])
    .pipe('greet', 'name', 'message')
    .pipe((message) => seen.push(message), 'message')
    .end()('World')
  eq('quick start', seen, ['Hello, World!'])

  const sum = sp('sum')
    .input(['x', 'y'])
    .pipe((a, b) => a + b, ['x', 'y'], 'sum')
    .end('sum')
  eq('sync output', sum(2, 3), 5)

  const gated = sp('gated')
    .pipe(() => 'ran', null, 'result')
    .pipe('!isBlocked')
    .pipe(() => 'after', null, 'later')
    .end(['result', 'later'])
  eq('flow control', gated(), ['ran', 'after'])

  const declarative = sp('declarative', [
    ['input', ['n']],
    [(n) => n * 2, 'n', 'doubled'],
    ['end', 'doubled'],
  ])
  eq('declarative', declarative(21), 42)

  const later = sp('async')
    .input(['n'])
    .pipe((next, n) => setTimeout(() => next(null, n + 1), 1), ['next', 'n'], 'out')
    .endAsync('out')
  eq('endAsync', await later(1), 2)

  const controller = new AbortController()
  controller.abort('stop')
  let aborted = false
  try {
    await later.withSignal(controller.signal, 1)
  } catch (error) {
    aborted = error instanceof PipelineAbortedError && error.reason === 'stop'
  }
  eq('withSignal abort', aborted, true)

  const tp = typed({ greet: (name) => `Hello, ${name}!` })
  eq('typed runtime', tp('t').input('name').pipe('greet', 'name', 'm').end('m')('typed'), 'Hello, typed!')

  return '7 behaviors'
}

const consumerTs = `import superpipe, { typed, PipelineAbortedError } from 'superpipe'

const sp = superpipe({ greet: (name: string) => \`Hello, \${name}!\` })
const untyped = sp('sum').input(['x']).pipe('greet', 'x', 'm').end('m')
untyped('a')
const declarative = sp('d', [['input', ['n']]])
declarative(1)

const tp = typed({ greet: (name: string) => \`Hello, \${name}!\` })
const greet = tp<[string]>('greet').input('name').pipe('greet', 'name', 'm').endAsync('m')
const out: Promise<string> = greet('x')
const cancelled: Promise<string> = greet.withSignal(new AbortController().signal, 'x')
const err: Error = new PipelineAbortedError()

// @ts-expect-error unknown input name must be rejected
tp<[string]>('bad').input('name').pipe('greet', 'nope', 'm')

export { out, cancelled, err }
`

function packTarball() {
  const packDir = join(work, 'pack')
  mkdirSync(packDir)
  run('npm', ['pack', '--silent', '--pack-destination', packDir], repo)
  const tgz = readdirSync(packDir).find((f) => f.endsWith('.tgz'))
  if (!tgz) throw new Error('npm pack produced no tarball')
  return join(packDir, tgz)
}

function makeConsumer(tarball) {
  const dir = join(work, 'consumer')
  mkdirSync(dir)
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true }))
  run('npm', ['install', '--no-audit', '--no-fund', '--ignore-scripts', tarball], dir)
  const fn = `const smoke = ${smoke.toString()}\n`
  const report = `.then((s) => console.log(s), (e) => { console.error(e.message); process.exit(1) })\n`
  writeFileSync(join(dir, 'esm.mjs'), `import * as ns from 'superpipe'\n${fn}smoke(ns)${report}`)
  writeFileSync(join(dir, 'cjs.cjs'), `const ns = require('superpipe')\n${fn}smoke(ns)${report}`)
  writeFileSync(
    join(dir, 'iife.cjs'),
    `const vm = require('node:vm')\nconst fs = require('node:fs')\n` +
      `const ctx = vm.createContext({ setTimeout, AbortController })\n` +
      `vm.runInContext(fs.readFileSync(require.resolve('superpipe/package.json').replace('package.json', 'dist/superpipe.min.js'), 'utf8'), ctx)\n` +
      `${fn}smoke(ctx.Superpipe)${report}`,
  )
  writeFileSync(join(dir, 'consumer.mts'), consumerTs)
  writeFileSync(join(dir, 'consumer.cts'), consumerTs)
  return dir
}

function goConsumer() {
  const dir = join(work, 'go-consumer')
  mkdirSync(dir)
  writeFileSync(
    join(dir, 'go.mod'),
    `module consumer\n\ngo 1.22\n\nrequire github.com/lsm/superpipe/go v0.0.0\n\nreplace github.com/lsm/superpipe/go => ${join(repo, 'go')}\n`,
  )
  writeFileSync(
    join(dir, 'main.go'),
    `package main

import (
	"context"
	"errors"
	"fmt"

	superpipe "github.com/lsm/superpipe/go"
)

func main() {
	run, err := superpipe.Build("checkout", superpipe.Deps{"isBlocked": false},
		superpipe.Input("userId"),
		superpipe.Step("charge", func(_ context.Context, args []any) (any, error) {
			id, _ := superpipe.Get[string](args, 0)
			return "receipt-" + id, nil
		}).In("userId").Out("receipt"),
		superpipe.Not("isBlocked"),
		superpipe.Output("receipt"),
	)
	if err != nil {
		panic(err)
	}
	out, err := run.Run(context.Background(), "u-123")
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, cerr := run.Run(ctx, "u-123")
	fmt.Println(out, err, errors.Is(cerr, superpipe.ErrAborted))
}
`,
  )
  return dir
}

try {
  if (!args.has('--go-only')) {
    if (!args.has('--skip-build')) check('build', () => (run('npm', ['run', 'build'], repo), ''))
    let consumer
    check('pack + install tarball', () => {
      const tarball = packTarball()
      consumer = makeConsumer(tarball)
      const pkg = JSON.parse(readFileSync(join(consumer, 'node_modules/superpipe/package.json'), 'utf8'))
      return `${pkg.name}@${pkg.version}`
    })
    if (consumer) {
      check('ESM import', () => run('node', ['esm.mjs'], consumer).trim())
      check('CJS require', () => run('node', ['cjs.cjs'], consumer).trim())
      check('IIFE global Superpipe', () => run('node', ['iife.cjs'], consumer).trim())
      const tscArgs = ['--noEmit', '--strict', '--skipLibCheck', 'false', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--target', 'es2022', '--lib', 'es2022,dom']
      const typecheck = (file) => {
        const tsc = join(dirname(createRequire(join(repo, 'package.json')).resolve('typescript/package.json')), 'bin/tsc')
        return run('node', [tsc, ...tscArgs, file], consumer) || 'tsc exit 0'
      }
      check('types (ESM consumer)', () => typecheck('consumer.mts'))
      check('types (CJS consumer)', () => typecheck('consumer.cts'))
    }
  }
  if (!args.has('--no-go')) {
    check('Go module consumer', () => {
      const out = run('go', ['run', '.'], goConsumer(), { GOWORK: 'off', GOFLAGS: '-mod=mod' }).trim()
      if (out !== 'receipt-u-123 <nil> true') throw new Error(`unexpected output: ${out}`)
      return out
    })
  }
} finally {
  if (args.has('--keep')) console.log(`kept ${work}`)
  else rmSync(work, { recursive: true, force: true })
}

const failed = results.filter((r) => !r.ok).length
console.log(`verify: ${results.length - failed} passed, ${failed} failed`)
process.exit(failed === 0 && results.length > 0 ? 0 : 1)
