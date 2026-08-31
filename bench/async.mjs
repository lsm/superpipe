// Async executor benchmarks: promise-returning pipes run sequentially and
// 20k runs concurrently, against the same awaits written as a plain async
// function. Microtask scheduling dominates at this depth, so read the
// overhead ratio rather than absolute time.
import superpipe from '../dist/index.mjs'
import { envLine } from './env.mjs'

const asyncInc = (v) => Promise.resolve((v || 0) + 1)

const plainAsync5 = async () => {
  let v = 0
  v = await asyncInc(v)
  v = await asyncInc(v)
  v = await asyncInc(v)
  v = await asyncInc(v)
  return asyncInc(v)
}

function buildAsync(depth) {
  let p = superpipe({})('bench-async').pipe(asyncInc, null, 'v')
  for (let i = 1; i < depth; i++) {
    p = p.pipe(asyncInc, 'v', 'v')
  }
  return p.endAsync('v')
}

async function timeIt(name, run, { runs, pipes, warmup = runs, reps = 5 }) {
  for (let i = 0; i < warmup; i++) await run()
  const times = []
  for (let rep = 0; rep < reps; rep++) {
    const t0 = performance.now()
    for (let i = 0; i < runs; i++) await run()
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
  }
}

if ((await plainAsync5()) !== 5) throw new Error('plain async baseline drifted')
const run = buildAsync(5)
if ((await run()) !== 5) throw new Error('async pipeline result drifted')
console.log(envLine())

const RUNS = 20000
const rows = [
  await timeIt('plain async 5-await', plainAsync5, { runs: RUNS, pipes: 5, warmup: 2000 }),
  await timeIt('async 5-pipe', run, { runs: RUNS, pipes: 5, warmup: 2000 }),
]
const overheadX = rows[1].nsPerPipe / rows[0].nsPerPipe

const concurrent = buildAsync(3)
if ((await concurrent()) !== 3) throw new Error('concurrent pipeline result drifted')
await Promise.all(Array.from({ length: 2000 }, () => concurrent())) // warmup batch
const concurrentTimes = []
for (let rep = 0; rep < 5; rep++) {
  const t0 = performance.now()
  await Promise.all(Array.from({ length: RUNS }, () => concurrent()))
  concurrentTimes.push(performance.now() - t0)
}
const concurrentSorted = [...concurrentTimes].sort((a, b) => a - b)
const concurrentMedianMs = concurrentSorted[concurrentSorted.length >> 1]
const concurrentBestMs = concurrentSorted[0]

for (const r of rows) {
  const per = r.name.includes('plain') ? 'ns/call' : 'ns/pipe'
  console.log(
    `${r.name.padEnd(24)} median ${r.medianMs.toFixed(1)}ms  best ${r.bestMs.toFixed(1)}ms  (${r.runs} runs)  ${r.nsPerPipe.toFixed(0)} ${per}`,
  )
}
console.log(
  `${'async 3-pipe concurrent'.padEnd(24)} median ${concurrentMedianMs.toFixed(1)}ms  best ${concurrentBestMs.toFixed(1)}ms  (5 x ${RUNS} runs)  ${((concurrentMedianMs / RUNS) * 1e6).toFixed(0)}ns amortized per run`,
)
console.log(`${'overhead ratio'.padEnd(24)} ${overheadX.toFixed(1)}x per step (engine vs plain await)`)
