# Benchmarks

Zero-dependency, ad-hoc benchmarks for the executor. They are not run in CI —
absolute numbers are machine- and Node-version-dependent, so every run stamps
its environment; compare only runs from the same machine.

## Run them all

```sh
npm run bench
```

Or individually — the scripts import the built package from `dist/`, which is
gitignored, so build first on a fresh checkout (`npm run bench` already does);
`mem.mjs` also needs the flag:

```sh
npm run build
node bench/perf.mjs
node bench/async.mjs
node --expose-gc bench/mem.mjs
```

## What each script measures

| Script | Measures |
| --- | --- |
| `perf.mjs` | Sync per-pipe cost against the same pipe bodies called as plain functions (the overhead ratio), one **separate single-pipe workload per output-spec form** (pick, rename, destructure, merge), and a warmed, repeated 100k-deep cascade proving stack safety. |
| `async.mjs` | Promise-returning pipes run sequentially and 20k runs concurrently, against a plain `async`/`await` twin. |
| `mem.mjs` | Per-run retention over 100k runs (leak detection), a deep run's post-run heap usage, and `endAsync`'s heap delta. The deep figures are sampled after the (synchronous, microtask-only) run returns — for a true in-run peak use `node --heap-prof`. |

## Reading the numbers

- Each timed workload does a full warmup pass, then 5–7 repetitions; the
  **median** is the headline, and every repetition is printed so outliers and
  bimodal runs are visible before you apply the ~5% noise rule.
- The four output-spec rows are single-pipe pipelines, so their per-pipe
  figure includes the fixed per-run setup cost — compare them to each other,
  and to `shallow` for the marginal pipe cost.
- The interesting number is the **overhead ratio** (engine ns/pipe ÷ plain
  ns/call), not absolute time — it survives machine differences and tracks
  what optimization work moves. Caveat: V8 inlines the plain baseline to near
  nothing (~2ns/call), so the ratio is measured against the theoretical
  floor of hand-written code, not a realistic workload. Read the ratio as a
  trend line and ns/pipe as the absolute cost.
- Every pipeline result is sanity-checked before timing (values, plus leak
  probes for the keys the pick and rename forms must not bind), so a semantic
  regression fails the benchmark instead of producing fast garbage.
- The deep cascade is warmed and timed 5 times; it doubles as the stack-safety
  check (no `RangeError` at 100k pipes).
- Before optimizing anything, profile a workload and look:

```sh
node --cpu-prof --cpu-prof-dir=prof bench/perf.mjs
```

## Saving baselines

`perf.mjs --json` emits machine-readable rows (env stamp included) so
before/after comparisons are a diff instead of transcription. The scripts
import the **built** package from `dist/`, so rebuild after editing the
executor or the second run silently benchmarks the old build:

```sh
node bench/perf.mjs --json > bench-before.json
# ...change the executor...
npm run build
node bench/perf.mjs --json > bench-after.json
```
