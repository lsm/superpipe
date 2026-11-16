# Journey: the Go module

Use for any change under `go/` or to `docs/go-port-spec.md` that changes behavior.

```bash
node scripts/verify-package.mjs --go-only
```

It writes a throwaway Go module that imports `github.com/lsm/superpipe/go` through a `replace`
directive to this checkout, runs a gated pipeline (`Input`, `Step`, `Not`, `Output`), then runs it
again with a cancelled context.

Pass: `PASS Go module consumer — receipt-u-123 <nil> true` (the result, no error, and
`errors.Is(err, ErrAborted)` for the cancelled run), last line `verify: 1 passed, 0 failed`, exit
code 0.

For a new Go behavior, extend `main.go` in `goConsumer()` and its expected output string in the
same file.

Prove the check can fail: change the expected output string or break `go/run.go` temporarily,
rerun, see `FAIL` and a non-zero exit, then restore.
