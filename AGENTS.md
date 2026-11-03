# Verification before merging

Run `pnpm test:plan --base main` to inspect the selected test sets, then
`pnpm test --base main` before merging. Substitute the actual merge target if it
is not `main`. The runner includes committed changes and local edits. Provide a
dedicated test `DATABASE_URL` when API integration is selected. Do not replace
this check with an arbitrary subset or skip a selected suite.

See `docs/testing.md` for named suites and the additional browser/audio checks
for UI and DSP changes. Use `pnpm test:all` for a full automated regression run.

If `pnpm build` fails, a common fix on this machine is to try `pnpm fullbuild`
or run a command that sets `NODE_ENV` to `production`.
