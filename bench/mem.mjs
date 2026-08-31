// Memory benchmarks: per-run retention over 100k runs (leak detection), a
// deep run's transient heap peak, and endAsync's heap delta. Forced GC
// between phases keeps the readings honest, so this script refuses to run
// without --expose-gc.
import process from 'node:process'
import superpipe from '../dist/index.mjs'
import { envLine } from './env.mjs'

if (!globalThis.gc) {
  console.error('mem.mjs needs forced GC between phases — run: node --expose-gc bench/mem.mjs')
  process.exit(1)
}

const fmt = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`

console.log(envLine())

const inc = (v) => v + 1

function buildShallow() {
  return superpipe({})('bench-shallow')
    .pipe((v) => (v || 0) + 1, null, 'v')
    .pipe(inc, 'v', 'v')
    .pipe(inc, 'v', 'v')
    .pipe(inc, 'v', 'v')
    .pipe(inc, 'v', 'v')
    .end('v')
}

function buildDeep(depth) {
  let p = superpipe({})('bench-deep').pipe((v) => (v || 0) + 1, null, 'v')
  for (let i = 1; i < depth; i++) {
    p = p.pipe(inc, 'v', 'v')
  }
  return p.end('v')
}

// --- 1. Shallow pipeline: per-run allocation (steady state, GC'd) ---
const shallow = buildShallow()
if (shallow() !== 5) throw new Error('shallow pipeline result drifted')
for (let i = 0; i < 10000; i++) shallow() // warmup
globalThis.gc()
const baseHeap = process.memoryUsage().heapUsed
const RUNS = 100000
for (let i = 0; i < RUNS; i++) shallow()
globalThis.gc()
const afterGcHeap = process.memoryUsage().heapUsed

// measure live-at-peak: run again WITHOUT gc in between, sampling peak
let peak = 0
for (let i = 0; i < RUNS; i++) {
  shallow()
  if (i % 1000 === 0) peak = Math.max(peak, process.memoryUsage().heapUsed)
}
globalThis.gc()

console.log('--- shallow 5-pipe pipeline ---')
console.log(`heap after warmup+gc : ${fmt(baseHeap)}`)
console.log(`heap after 100k runs + gc: ${fmt(afterGcHeap)} (retained delta: ${fmt(afterGcHeap - baseHeap)})`)
console.log(
  `max sampled heap (every 1000 of 100k runs, no gc): ${fmt(peak)} — a lower bound; automatic GC can hide transients between samples`,
)

// --- 2. Deep pipeline: post-run heap usage of one deep cascade ---
// Sampled only after deep() returns: the run is synchronous and
// microtask-only, so nothing can poll the heap mid-run. GC may already have
// collected intermediates — treat these as post-run figures, not a peak;
// for a true in-run peak use a heap profiler (node --heap-prof).
const DEPTH = 100000
const deep = buildDeep(DEPTH)
globalThis.gc()
const preDeep = process.memoryUsage().heapUsed
const rssBefore = process.memoryUsage().rss
let result = deep()
const postRunDeep = process.memoryUsage().heapUsed
const rssAfter = process.memoryUsage().rss
globalThis.gc()
const postDeep = process.memoryUsage().heapUsed
if (result !== 100000) throw new Error('deep cascade result drifted')

console.log(`--- deep ${DEPTH}-pipe pipeline ---`)
console.log(`result: ${result}`)
console.log(`heap before run: ${fmt(preDeep)}, right after run: ${fmt(postRunDeep)}, after gc: ${fmt(postDeep)}`)
console.log(`rss delta across deep run: ${fmt(rssAfter - rssBefore)}`)

// --- 3. Deep pipeline via endAsync ---
const DEPTH2 = 50000
let p2 = superpipe({})('bench-deep-async').pipe((v) => (v || 0) + 1, null, 'v')
for (let i = 1; i < DEPTH2; i++) p2 = p2.pipe(inc, 'v', 'v')
const deepAsync = p2.endAsync('v')
globalThis.gc()
const preAsync = process.memoryUsage().heapUsed
const asyncResult = await deepAsync()
const postAsync = process.memoryUsage().heapUsed
globalThis.gc()
if (asyncResult !== DEPTH2) throw new Error('async deep cascade result drifted')

console.log(`--- deep ${DEPTH2}-pipe endAsync ---`)
console.log(`heap delta during async deep run: ${fmt(postAsync - preAsync)}`)
