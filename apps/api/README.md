# Banger cloud backend

`@banger/api` is a Next.js service. `@banger/www` stays a static export so Electron can keep packaging it. The browser connects through the Cloud projects panel. Access tokens stay in memory and are never placed in URLs or local storage. The panel currently accepts a JWT from your identity provider; it does not implement a hosted sign-in screen.

## Setup

Use Node 24 and the repository's pnpm version. Provision PostgreSQL, a **private** Vercel Blob store, a Vercel project with Sandbox access, and a JWT issuer. Copy `.env.example` to `.env.local` and set the values for that environment. No credentials are required to build.

From the repository root:

```sh
pnpm install
pnpm --filter @banger/harness... build
pnpm --filter @banger/api exec node --env-file=.env.local scripts/migrate.mjs
pnpm --filter @banger/api sandbox:bundle
pnpm --filter @banger/api exec node --env-file=.env.local scripts/publish-runner.mjs
pnpm --filter @banger/api dev
pnpm dev:www
```

The publish command uploads the trusted bundled harness runtime, prints `SANDBOX_RUNNER_BLOB_PATH`, and does not expose a public download URL. Set that variable on the API deployment. Republish the runner after changes to the harness, agent, compiler, or runner. Runtime credentials sent to Sandbox contain only the selected model key. Database and Blob credentials stay in the backend.

For local Sandbox authentication, link the Vercel project and pull its environment with the Vercel CLI. The SDK reads `VERCEL_OIDC_TOKEN`; production uses the deployment identity. The migration command uses the configured PostgreSQL connection, including any TLS parameters required by the database host.

Deploy `apps/api` as its own Vercel project, including workspace files outside the root directory. Build from the repository root with `pnpm exec turbo run build --filter=@banger/api...`. Run the migration separately before serving requests. Set `CLIENT_ORIGINS` to exact client origins and configure the client's `NEXT_PUBLIC_BANGER_API_URL` before building it. `AUTH_JWKS_URL`, `AUTH_ISSUER`, and `AUTH_AUDIENCE` must describe the JWT issuer. Subjects identify users; unverified identity headers are never accepted.

`vercel.json` schedules one worker step per minute and requires a plan that supports that cadence. Set `CRON_SECRET` to protect `/api/worker`. An external scheduler may call the same endpoint with `Authorization: Bearer <CRON_SECRET>`. The client also resumes active jobs while open. A browser disconnect does not cancel work. The worker claims one due job per invocation, so increase scheduler throughput for a larger queue. Each step has a six-minute database lease and a five-minute function budget.

## Persistence and conflicts

Every saved file version and manifest is an immutable private Blob object. PostgreSQL records the manifest's path and indexed revision metadata. It also records users, ownership, viewer/editor grants, agent sessions, jobs, and audio references.

A save compiles all submitted `.banger` source before any publication. It writes immutable objects, then locks the project row, rechecks permissions and the expected revision, and publishes the new manifest and revision in one transaction. A stale client receives HTTP 409 and keeps its draft. Failed or conflicting writes can leave unreferenced Blob objects; they never become the current project. Garbage collection is deliberately not automatic. Any future collector must retain objects referenced by all historical manifests, artifacts, pending uploads, and job checkpoints.

Sync uses `GET /api/projects/:id?since=N` to return changed source and deleted paths. Projects are limited to 256 files, 64 KiB per file, and 4 MiB of total source. Lists return at most 100 projects, 50 jobs, or 50 artifacts. Older revisions remain available to the backend for manifests and artifact provenance; the panel displays current projects and recent activity.

Each cloud agent task has its own session and named Sandbox. The runner materializes the base revision under `/vercel/sandbox/project` and invokes the existing `ProjectSession` and filesystem `ProjectWorkspace`. The harness compiles each write. An atomic runner lock prevents duplicate model execution after a replayed launch. The backend revalidates the resulting source and publishes against the task's base revision. Conflicts retain a private candidate result that the client can download for comparison. Each task starts a new model conversation with the saved project as context.

## Audio and pending ElevenLabs integration

Load a saved cloud file into the studio to enable Upload WAV to cloud. The existing `renderWav` engine uses `OfflineAudioContext`; Export WAV and Export stem still download locally. Studio edits must be saved to a cloud revision and loaded again before they can be uploaded with that revision's provenance.

The client reserves an artifact, requests a signed token for that exact path, and uploads directly to private Blob. Tokens expire after ten minutes, prohibit overwrites, limit uploads to 100 MiB, and accept only `audio/wav`. A signed completion callback or an authenticated client finalization verifies the Blob metadata and PCM WAV header before marking the artifact ready. Audio reads go through an authenticated API route. Private Blob URLs and credentials are never returned as playback links.

ElevenLabs submissions are stored and shown as `awaiting_provider`. **The provider adapter is intentionally pending.** No ElevenLabs API requests are made. Implement `AudioProvider` in `src/server/audio-provider.ts` when the operation is chosen. Its submit method must honor the stable job ID as an idempotency key, or recover an existing provider request by that key. The worker persists the provider request ID, polls progress, saves resulting audio in private Blob, and atomically attaches the result to its job. A resume request requeues an awaiting submission after the adapter is installed. It must never blindly repeat a provider operation that lacks idempotency.

## API

All endpoints except signed Blob callbacks and the separately authenticated worker require `Authorization: Bearer <JWT>`.

| Route | Purpose |
| --- | --- |
| `GET/POST /api/projects` | List accessible projects or create one with `name` and `files` |
| `GET /api/projects/:id?since=N` | Read a full project or revision delta |
| `PATCH /api/projects/:id` | Save `{baseRevision, changes: [{path, source}]}`; `source: null` deletes |
| `PUT /api/projects/:id/members` | Owner sets `{userId, role}` to `viewer`, `editor`, or `null` |
| `GET/POST /api/projects/:id/jobs` | List jobs or enqueue `{kind, idempotencyKey, input}` |
| `GET /api/jobs/:id` | Job status, progress, activity, and result references |
| `POST /api/jobs/:id/resume` | Wake an eligible job |
| `GET /api/jobs/:id/candidate` | Retrieve conflicting agent files |
| `GET/POST /api/projects/:id/artifacts` | List audio or reserve a WAV for `{revision}` |
| `POST /api/uploads` | Blob SDK token exchange and signed completion callbacks |
| `POST /api/artifacts/:id/complete` | Verify a completed client upload |
| `GET /api/artifacts/:id` | Authenticated audio stream |

Agent input is `{baseRevision, prompt, activeFile?}`. Pending ElevenLabs input is `{artifactId}`. Job keys are UUIDs and must be reused for retries of the same submission. Reusing a key with different input returns 409.

## Verification

Use a dedicated test database, migrate it, and build the API before the HTTP test:

```sh
DATABASE_URL=postgresql://localhost/banger_test pnpm --filter @banger/api test
BANGER_HTTP_TEST=1 DATABASE_URL=postgresql://localhost/banger_test pnpm --filter @banger/api exec tsx --test test/http.test.ts
pnpm lint
pnpm typecheck
pnpm fullbuild
pnpm --filter @banger/desktop smoke:cloud
pnpm --filter @banger/desktop smoke
pnpm verify:audio
```

API tests cover PostgreSQL concurrency and permissions, JWT verification, upload authorization, job leases, and a bundled harness editing a real local filesystem with a fixture model. The cloud browser smoke uses an HTTP API fixture and renders a real WAV. These checks do not substitute for a deployment test against Vercel Sandbox and private Blob with production credentials.
