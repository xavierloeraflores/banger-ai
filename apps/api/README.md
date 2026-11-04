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

## Audio and ElevenLabs music

Load a saved cloud file into the studio to enable Upload WAV to cloud. The existing `renderWav` engine uses `OfflineAudioContext`; Export WAV and Export stem still download locally. Studio edits must be saved to a cloud revision and loaded again before they can be uploaded with that revision's provenance.

The client reserves an artifact, requests a signed token for that exact path, and uploads directly to private Blob. Tokens expire after ten minutes, prohibit overwrites, limit uploads to 100 MiB, and accept only `audio/wav`. A signed completion callback or an authenticated client finalization verifies the Blob metadata and RIFF/WAVE structure before marking the artifact ready. Audio reads go through an authenticated API route. Private Blob URLs and credentials are never returned as playback links.

Set `ELEVENLABS_API_KEY` on the API server to enable the song workshop. Uploaded WAVs are analyzed with `music.upload` and `extract_composition_plan: music_v2_5`. The SDK adapter lives in `@banger/elevenlabs`; it also serves the local desktop app. Without a key, cloud submissions remain `awaiting_provider` and can be resumed after configuration.

The workshop displays the extracted chunks, preserves their musical properties when editing lyrics, and can propose AI lyrics for selected chunks. Full generation and selective inpainting use `composeDetailed` with `storeForInpainting`. Unselected chunks reference their exact ranges in the current stored song. New audio is private Blob content; every composition revision has an immutable Blob receipt and PostgreSQL version record. A transaction checks the current revision and job lease before publishing its plan and artifact reference.

ElevenLabs does not document idempotency for these operations. Workers disable SDK retries and checkpoint before each paid request. If a request is interrupted without a saved result, it becomes `needs_review`; resuming does not repeat the paid call. If the result receipt exists, recovery can finish publication without another provider call. Progress represents queued, processing, saving, and completed stages, not provider-reported percentages. A conflicting result remains stored for review. The original WAV and all earlier composition/audio versions remain intact.

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
| `GET /api/projects/:id/music` | List up to 100 music sessions |
| `GET /api/music/:id` | Current composition and audio reference |
| `GET /api/music/:id/versions` | Up to 50 immutable composition versions |
| `POST /api/music/:id/actions` | Enqueue `{idempotencyKey, action}` for lyrics or generation |

Agent input is `{baseRevision, prompt, activeFile?}`. ElevenLabs analysis input is `{artifactId}`. A music action is `{operation: "edit", baseVersion, edits: [{index, lyrics}]}`, `{operation: "lyrics", baseVersion, prompt, indices}`, or `{operation: "generate", baseVersion, indices}`. Indices are zero-based. Selecting every chunk generates a new song; selecting a subset keeps the other audio ranges. Job keys are UUIDs and must be reused for retries of the same submission. Reusing a key with different input returns 409.

## Verification

Run the selected API set from the repository root:

```sh
pnpm test:suite api-unit
DATABASE_URL=postgresql://localhost/banger_test pnpm test:suite api-integration
```

The integration set builds dependencies and the production API, applies
migrations to the dedicated test database, and enables the HTTP test. The unit
set requires no database. See [test suites](../../docs/testing.md) for affected
selection and additional cloud/music browser checks.

API tests cover PostgreSQL concurrency and permissions, JWT verification, upload authorization, job leases, and a bundled harness editing a real local filesystem with a fixture model. The music smoke tests use fixture provider responses, decode and play a synthesized MP3, and verify byte-exact downloads in desktop and browser modes. The cloud browser smoke uses an HTTP API fixture and renders a real WAV. These checks do not substitute for a deployment test against Vercel Sandbox and private Blob with production credentials.

## Local desktop music

For development, set `ELEVENLABS_API_KEY` in `apps/desktop/.env.local`; packaged applications read it from their launch environment. The Electron main process owns the key and makes provider calls. The renderer receives only a scoped IPC bridge for importing WAVs, editing compositions, reading progress, and saving audio through native dialogs.

Music is stored under Electron's user-data directory in `elevenlabs-music`: immutable version documents, audio files, operation records, and result receipts. Atomic current pointers and a serialized write queue prevent competing edits. On restart the workshop recovers saved receipts, while interrupted requests without a receipt require review. The desktop workflow runs without PostgreSQL, Blob, or a cloud login. Uploads for analysis must be PCM/float WAVs of 3 seconds to 10 minutes, up to 100 MiB; generated downloads are MP3.

### Waveform and word timings

Music upload and detailed generation both request `with_timestamps` and
`with_waveform_visual`. Each immutable music version retains `audioMetadata`:
`wordsTimestamps` contains `{ word, startMs, endMs }` entries in milliseconds;
`waveformVisual` contains mono preview samples at four values per second, from
-1000 to 1000. An empty timestamp array represents an instrumental response;
missing or null fields mean the provider supplied no measurements.

On desktop these fields are saved with `audioId`, `audioVersion`, `songId`, and
the composition plan in `<song>.lyrics.json` beside the `.banger` source, and in
`.banger/history/<song>/lyrics/lyrics-vNNN.json`. Original and generated audio
remain in the song's instrumental/vocal history directories. Library exports
retain the version documents too. Cloud versions and recovery receipts preserve
the same metadata.

Lyric drafts keep the measurements of their referenced audio. Generating audio
replaces the measurements, including clearing old values when a response omits
them. Consumers must use `audioVersion`, not the lyric document's `version`, when
matching timings to a recording. This storage adds no waveform or karaoke view.
