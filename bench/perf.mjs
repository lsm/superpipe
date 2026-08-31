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

// One pipe per output-spec form: pick, rename, destructure, merge. The end
// spec names every form's binding plus the two keys that must NOT survive —
// c, which the pick must drop, and src, which the rename must consume — so
// the sanity check below fails if any form stops producing OR leaks keys.
function buildSpecs() {
  return superpipe({})('bench-specs')
    .pipe(() => ({ a: 1, b: 2, c: 3 }), null, '{a, b}')
    .pipe(() => ({ src: 9 }), 'a', 'src:dst')
    .pipe(() => ['p', 'q'], null, ['p', 'q'])
    .pipe(() => ({ m: 7 }), null, '{...}')
    .end('{a, b, dst, p, q, m, c, src}')
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

if (plain5(0) !== 5) throw new Error('plain baseline drifted')
const shallow = buildShallow()
if (shallow() !== 5) throw new Error('shallow pipeline result drifted')
const specs = buildSpecs()
const specWant = { a: 1, b: 2, dst: 9, p: 'p', q: 'q', m: 7 }
const specOut = specs()
for (const key of Object.keys(specWant)) {
  if (specOut?.[key] !== specWant[key]) {
    throw new Error(`output-spec regression at ${key}: got ${JSON.stringify(specOut?.[key])}`)
  }
}
for (const key of ['c', 'src']) {
  if (specOut?.[key] !== undefined) {
    throw new Error(`output-spec leak at ${key}: got ${JSON.stringify(specOut[key])}`)
  }
}
const deep = buildDeep(100000)
const t0 = performance.now()
const deepResult = deep()
const deepCascadeMs = performance.now() - t0
if (deepResult !== 100000) throw new Error('deep cascade result drifted')

const rows = [
  timeIt('plain 5-call baseline', () => plain5(0), { runs: 100000, pipes: 5 }),
  timeIt('shallow 5-pipe', shallow, { runs: 100000, pipes: 5 }),
  timeIt('output-spec 4-pipe', specs, { runs: 100000, pipes: 4 }),
  timeIt('mid 600-pipe', buildDeep(600), { runs: 5000, pipes: 600, warmup: 2000 }),
]
const overheadX = rows[1].nsPerPipe / rows[0].nsPerPipe

if (json) {
  console.log(JSON.stringify({ env: env(), rows, deepCascadeMs, overheadX }, null, 2))
} else {
  console.log(envLine())
  for (const r of rows) {
    const per = r.name.includes('plain') ? 'ns/call' : 'ns/pipe'
    console.log(
      `${r.name.padEnd(24)} median ${r.medianMs.toFixed(1)}ms  best ${r.bestMs.toFixed(1)}ms  (${r.runs} runs)  ${r.nsPerPipe.toFixed(0)} ${per}`,
    )
  }
  console.log(`${'deep 100k cascade'.padEnd(24)} ${deepCascadeMs.toFixed(0)}ms single run, stack-safe`)
  console.log(`${'overhead ratio'.padEnd(24)} ${overheadX.toFixed(1)}x per step (engine vs plain call)`)
}
