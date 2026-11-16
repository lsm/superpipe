# Journey: a behavior change, end to end

Use when a change alters what a pipeline does or exposes (a new option, a new runner property, a
different outcome).

1. Write the README example first. It is the user's view of the change.
2. Pin it in the matching contract suite (table in `SKILL.md`), asserting what the example shows,
   not internals. For a bug, commit the failing case before the fix.
3. If types change, add the positive and the rejected form to `test/typed.test-d.ts`.
4. Decide the Go side: implement it in `go/` with tests and a numbered contract in §4 of
   `docs/go-port-spec.md`, or record it as a deliberate divergence in §2 and in the Go Port
   paragraph of `AGENTS.md`.
5. Run the gates in `SKILL.md`.
6. Run `installed-package.md` with the example added to its smoke routine, and `go-module.md` if
   Go changed. Break the new behavior once to see its check fail, then restore.

Pass: all gates exit 0, the journeys print `0 failed` with the new check among the `PASS` lines,
and the deliberate break produced a `FAIL` for that check.
