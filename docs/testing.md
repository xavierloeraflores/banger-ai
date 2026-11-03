# Test suites

Run from the repository root with Node 24 and pnpm 11.9.0 after `pnpm install`.

```sh
pnpm test:plan                       # Show suites affected since branching from main
pnpm test                           # Run those suites, including local edits
pnpm test --base main --head HEAD    # Committed changes only
pnpm test:suite desktop              # Run one set
pnpm test --suite compiler --suite engine
DATABASE_URL=postgresql://localhost/banger_test pnpm test:all
```

`--base` defaults to local `main`. Selection compares the merge base with `HEAD`
and includes staged, unstaged and untracked files. Use the actual merge target
when merging elsewhere, for example `--base origin/dev`. Explicit `--head`
excludes local edits. Missing Git refs fail with an error; fetch the base before
retrying. After a merge, use `--base HEAD^ --head HEAD` to test that merge.
`--json` prints the selected suite names without running them.

| Set | Coverage | Requirements |
| --- | --- | --- |
| `tooling` | Development launcher and test selector | None |
| `compiler` | Parser, arrangement, mixer, synth and performance | None |
| `engine` | Audio scheduling and engine unit tests | None |
| `stage` | Character rig, instrument animations and score synchronization | None |
| `agent` | Provider adapters and generated file validation | Fixture models |
| `harness` | Project filesystem and agent CLI | Fixture models |
| `elevenlabs` | Music adapter and protocol | Fixture provider |
| `desktop` | Native files, security, accounts and model settings | No Electron window |
| `web` | Browser file tests, web ESLint and TypeScript | No browser |
| `api-unit` | JWT, domain validation, sessions and sandbox runner | No database |
| `api-integration` | Database concurrency, permissions, jobs, music and production HTTP | Dedicated PostgreSQL database |

The runner builds required shared libraries first. Only `api-integration` builds
the production API. It requires `DATABASE_URL`, applies migrations, and enables
`BANGER_HTTP_TEST=1` so the HTTP tests cannot silently skip. Use a disposable test
database; tests write fixture records. `api-unit` clears database and HTTP flags
and deliberately skips database portions of the shared authentication and
project test files. No suite makes paid provider requests.

## Selection rules

`scripts/test-suites.mjs` owns the suite definitions. Changes select the owning
workspace and its transitive consumers using workspace manifests. The API unit
set excludes UI-only dependencies, while API integration includes the studio
because its HTTP test renders it. Desktop settings tests also read the web app's
`ai-providers.ts`; this cross-workspace input is declared explicitly.

For example, a producer CSS edit selects `web` and `api-integration`. A desktop
source edit selects `desktop`. An engine edit selects `engine`, `web` and
`api-integration`. Compiler edits include the compiler's downstream consumers.
Deleted and renamed files select both affected owners. Shared fixtures and the
runtime `packages/compiler/LANGUAGE.md` count as code inputs.

README, AGENTS and Markdown files under `docs/` do not select tests. Lockfiles,
workspace manifests, root build configuration, CI and selector changes select
all suites. Unclassified files also select all suites, so new code cannot skip
verification by accident. Add a new suite and selector regression tests when
introducing a workspace or a cross-workspace test input.

GitHub Actions uses the same selector for pull requests, pushes to `main` and
merge queues. Only the selected jobs run; PostgreSQL starts only for API
integration. Manual workflow runs execute all eleven suites. `Required tests`
provides one stable status check, including for documentation-only changes. Make
that check required in branch protection if merges should be enforced by GitHub.

## Browser and audio checks

`test:all` runs all eleven automated suites. Interactive Electron smoke tests and
rendered audio verification remain separate because they need a graphical
session and built app assets. Run the relevant checks after `pnpm fullbuild`.

| Changed area | Additional checks |
| --- | --- |
| Sequencer and piano roll | `pnpm --filter @banger/desktop smoke:grid`, `smoke:sequencer`, `smoke`, `smoke:web` |
| Arrangement and mixer | `pnpm --filter @banger/desktop smoke:song`, `smoke:song:web`; `pnpm verify:song` |
| Audio synthesis and DSP | `pnpm verify:audio` |
| Native workspace | `pnpm --filter @banger/desktop smoke:workspace` |
| AI settings and authentication | `pnpm --filter @banger/desktop smoke:byok`, `smoke:chatgpt`, `smoke:local`, `smoke:chat` |
| Music workshop | `pnpm --filter @banger/desktop smoke:music`, `smoke:music:web` |
| Cloud projects | `pnpm --filter @banger/desktop smoke:cloud` |
| Musical options | `pnpm --filter @banger/desktop smoke:musical` |
| Raw .banger editor | `pnpm --filter @banger/desktop exec electron scripts/smoke-source-editor.mjs` |
| Band stage | `pnpm --filter @banger/desktop exec electron scripts/smoke-stage.mjs` |

Each abbreviated `smoke:*` command in the table uses the same
`pnpm --filter @banger/desktop` prefix. Run the full browser/audio matrix for a
release or a change spanning these areas, not for every merge.
