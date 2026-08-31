// Sync executor benchmarks. The headline number is the overhead ratio: the
// same pipe bodies run through the engine vs. called as plain functions, so
// absolute machine speed largely cancels out. Every run stamps its
// environment; compare only runs from the same machine.
import process from 'node:process'
import superpipe from '../dist/index.mjs'
import { env, envLine } from './env.mjs'

const json = process.argv.includes('--json')

const inc = (v) => v + 1

function plain5(v) {
  v = inc(v)
  v = inc(v)
  v = inc(v)
  v = inc(v)
  return inc(v)
}

function buildShallow() {
  return superpipe({})('bench-shallow')
    .pipe((v) => (v || 0) + 1, null, 'v')
    .pipe(inc, 'v', 'v')
    .pipe(inc, 'v', 'v')
    .pipe(inc, 'v', 'v')
    .pipe(inc, 'v', 'v')
    .end('v')
}

// One single-pipe pipeline per output-spec form, so a regression in one form
// cannot hide behind the others in an aggregate. Each end spec also names the
// keys that must NOT survive — c, which the pick must drop, and src, which
// the rename must consume — so leaks fail the sanity checks below.
function buildPick() {
  return superpipe({})('bench-pick')
    .pipe(() => ({ a: 1, b: 2, c: 3 }), null, '{a, b}')
    .end('{a, b, c}')
}

function buildRename() {
  return superpipe({})('bench-rename')
    .pipe(() => ({ src: 9 }), null, 'src:dst')
    .end('{dst, src}')
}

function buildDestructure() {
  return superpipe({})('bench-destructure')
    .pipe(() => ['p', 'q'], null, ['p', 'q'])
    .end('{p, q}')
}

function buildMerge() {
  return superpipe({})('bench-merge')
    .pipe(() => ({ m: 7 }), null, '{...}')
    .end('{m}')
}

function buildDeep(depth) {
  let p = superpipe({})('bench-deep').pipe((v) => (v || 0) + 1, null, 'v')
  for (let i = 1; i < depth; i++) {
    p = p.pipe(inc, 'v', 'v')
  }
  return p.end('v')
}

function timeIt(name, run, { runs, pipes, warmup = runs, reps = 7 }) {
  for (let i = 0; i < warmup; i++) run()
  const times = []
  for (let rep = 0; rep < reps; rep++) {
    const t0 = performance.now()
    for (let i = 0; i < runs; i++) run()
    times.push(performance.now() - t0)
  }
  const sorted = [...times].sort((a, b) => a - b)
  const medianMs = sorted[sorted.length >> 1]
  return {
    name,
    runs,
    pipes,
    medianMs,
    bestMs: sorted[0],
    nsPerPipe: (medianMs / runs / pipes) * 1e6,
    repsMs: times.map((t) => Number.parseFloat(t.toFixed(1))),
  }
}

function medianOf(times) {
  const sorted = [...times].sort((a, b) => a - b)
  return { medianMs: sorted[sorted.length >> 1], bestMs: sorted[0], repsMs: times }
}

if (plain5(0) !== 5) throw new Error('plain baseline drifted')
const shallow = buildShallow()
if (shallow() !== 5) throw new Error('shallow pipeline result drifted')
const pick = buildPick()
const pickOut = pick()
if (pickOut?.a !== 1 || pickOut?.b !== 2 || pickOut?.c !== undefined) {
  throw new Error(`pick form regression: ${JSON.stringify(pickOut)}`)
}
const rename = buildRename()
const renameOut = rename()
if (renameOut?.dst !== 9 || renameOut?.src !== undefined) {
  throw new Error(`rename form regression: ${JSON.stringify(renameOut)}`)
}
const destructure = buildDestructure()
const destructureOut = destructure()
if (destructureOut?.p !== 'p' || destructureOut?.q !== 'q') {
  throw new Error(`destructure form regression: ${JSON.stringify(destructureOut)}`)
}
const merge = buildMerge()
const mergeOut = merge()
if (mergeOut?.m !== 7) throw new Error(`merge form regression: ${JSON.stringify(mergeOut)}`)

// Warm the deep cascade before timing it, then repeat: a cold first run
// would report JIT compilation as the result.
const deep = buildDeep(100000)
if (deep() !== 100000) throw new Error('deep cascade result drifted')
const deepTimes = []
for (let rep = 0; rep < 5; rep++) {
  const t0 = performance.now()
  const deepResult = deep()
  deepTimes.push(performance.now() - t0)
  if (deepResult !== 100000) throw new Error('deep cascade result drifted')
}
const deepCascade = medianOf(deepTimes)

const rows = [
  timeIt('plain 5-call baseline', () => plain5(0), { runs: 100000, pipes: 5 }),
  timeIt('shallow 5-pipe', shallow, { runs: 100000, pipes: 5 }),
  timeIt('output pick 1-pipe', pick, { runs: 100000, pipes: 1 }),
  timeIt('output rename 1-pipe', rename, { runs: 100000, pipes: 1 }),
  timeIt('output destructure 1-pipe', destructure, { runs: 100000, pipes: 1 }),
  timeIt('output merge 1-pipe', merge, { runs: 100000, pipes: 1 }),
  timeIt('mid 600-pipe', buildDeep(600), { runs: 5000, pipes: 600, warmup: 2000 }),
]
const overheadX = rows[1].nsPerPipe / rows[0].nsPerPipe

if (json) {
  console.log(JSON.stringify({ env: env(), rows, deepCascade, overheadX }, null, 2))
} else {
  console.log(envLine())
  for (const r of rows) {
    const per = r.name.includes('plain') ? 'ns/call' : 'ns/pipe'
    console.log(
      `${r.name.padEnd(26)} median ${r.medianMs.toFixed(1)}ms  best ${r.bestMs.toFixed(1)}ms  (${r.runs} runs)  ${r.nsPerPipe.toFixed(0)} ${per}`,
    )
    console.log(`${''.padEnd(26)} reps ${r.repsMs.join(', ')}`)
  }
  console.log(
    `${'deep 100k cascade'.padEnd(26)} median ${deepCascade.medianMs.toFixed(0)}ms  best ${deepCascade.bestMs.toFixed(0)}ms  stack-safe`,
  )
  console.log(`${''.padEnd(26)} reps ${deepCascade.repsMs.map((t) => t.toFixed(0)).join(', ')}`)
  console.log(`${'overhead ratio'.padEnd(26)} ${overheadX.toFixed(1)}x per step (engine vs plain call)`)
}
