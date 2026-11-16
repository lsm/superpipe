# Journey: the installed npm package

Use for any change to `src/`, the build config, `package.json` or the README examples.

```bash
node scripts/verify-package.mjs --no-go
```

It runs `npm run build`, packs the tarball with `npm pack`, installs it into a fresh temp
consumer project, and then:

- runs one smoke routine through `import superpipe from 'superpipe'` (ESM), the
  `require('superpipe')` result called directly as the factory with its named exports (CJS), and
  `dist/superpipe.min.js` loaded as a script (global `Superpipe`, in a Node `vm` context). It
  covers the README quick start, sync output, a `!` gate, the declarative form, `endAsync`,
  `withSignal` abort, and `typed()` at run time. A surface passes only when it prints
  `SMOKE COMPLETE` within 30 seconds, so a promise that never settles is a `FAIL`, not a silent
  exit 0;
- type-checks one consumer file as `.mts` and as `.cts` against the shipped declarations with
  `--strict --skipLibCheck false` under `nodenext`. One line carries `@ts-expect-error`, so types
  that silently became `any` fail.

Pass: every line starts with `PASS` and the last line is `verify: 7 passed, 0 failed` with exit
code 0. Add `--keep` to keep the temp consumer, `--skip-build` to reuse the current `dist/`.

For a new user-facing behavior, add its README example's observable result to `smoke()` in
`scripts/verify-package.mjs` (and bump the summary count); for new public types, add a line to
`consumerTs` that only compiles when the types are right plus an `@ts-expect-error` line for the
misuse they must reject.

Prove the check can fail: break the behavior in `src/` (for example delete
`export { typed } from './typed'` from `src/index.ts`), rerun, see the `FAIL` lines and a
non-zero exit, then restore the file. To prove an unsettled run fails, make `endAsync` never
resolve (in `src/pipeline/Pipeline.ts`, replace
`resolve(fetcher.fetch(outcome.container, [], pipeline.functions) as PipeOutput)` with
`fetcher.fetch(outcome.container, [], pipeline.functions)`): the three runtime checks must print
`no 'SMOKE COMPLETE' marker`.

Not covered: a real browser.
