# Banger cloud backend

`@banger/api` is a Next.js service. `@banger/www` stays a static export so Electron can keep packaging it. The hosted browser app starts with username/password signup or sign-in. Accounts own separate workspaces. Browser sessions use opaque HttpOnly cookies backed by PostgreSQL; logout revokes the session immediately. Electron continues to use the static studio without web authentication.

## Setup

Use Node 24 and the repository's pnpm version. Provision PostgreSQL, a **private** Vercel Blob store, a Vercel project with Sandbox access, and, for external API clients, a JWT issuer. Copy `.env.example` to `.env.local` and set the values for that environment. No credentials are required to build.

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

New source versions and manifests are immutable PostgreSQL objects. Existing Blob-backed source versions remain readable. PostgreSQL records revision metadata beside the source. It also records users, ownership, viewer/editor grants, agent sessions, jobs, and audio references.

A save compiles all submitted `.banger` source before any publication. It writes immutable source objects, then locks the project row, rechecks permissions and the expected revision, and publishes the new manifest and revision in one transaction. A stale client receives HTTP 409 and keeps its draft. Failed or conflicting writes can leave unreferenced source or Blob objects; they never become the current project. Garbage collection is deliberately not automatic. Any future collector must retain objects referenced by all historical manifests, artifacts, pending uploads, and job checkpoints.

Sync uses `GET /api/projects/:id?since=N` to return changed source and deleted paths. Projects are limited to 256 files, 64 KiB per file, and 4 MiB of total source. Lists return at most 100 projects, 50 jobs, or 50 artifacts. Older revisions remain available to the backend for manifests and artifact provenance; the panel displays current projects and recent activity.

Each cloud agent task has its own session and named Sandbox. The runner materializes the base revision under `/vercel/sandbox/project` and invokes the existing `ProjectSession` and filesystem `ProjectWorkspace`. The harness compiles each write. An atomic runner lock prevents duplicate model execution after a replayed launch. The backend revalidates the resulting source and publishes against the task's base revision. Conflicts retain a private candidate result that the client can download for comparison. Each task starts a new model conversation with the saved project as context.

## Audio and ElevenLabs music

Load a saved cloud file into the studio to enable Upload WAV to cloud. The existing `renderWav` engine uses `OfflineAudioContext`; Export WAV and Export stem still download locally. Studio edits must be saved to a cloud revision and loaded again before they can be uploaded with that revision's provenance.

The client reserves an artifact, requests a signed token for that exact path, and uploads directly to private Blob. Tokens expire after ten minutes, prohibit overwrites, limit uploads to 100 MiB, and accept only `audio/wav`. A signed completion callback or an authenticated client finalization verifies the Blob metadata and RIFF/WAVE structure before marking the artifact ready. Audio reads go through an authenticated API route. Private Blob URLs and credentials are never returned as playback links.

Set `ELEVENLABS_API_KEY` on the API server to enable the song workshop. Uploaded WAVs are analyzed with `music.upload` and `extract_composition_plan: music_v2_5`. The SDK adapter lives in `@banger/elevenlabs`; it also serves the local desktop app. Without a key, cloud submissions remain `awaiting_provider` and can be resumed after configuration.

The workshop displays the extracted chunks, preserves their musical properties when editing lyrics, and can propose AI lyrics for selected chunks. Full generation and selective inpainting use `composeDetailed` with `storeForInpainting`. Unselected chunks reference their exact ranges in the current stored song. New audio is private Blob content; every composition revision has an immutable Blob receipt and PostgreSQL version record. A transaction checks the current revision and job lease before publishing its plan and artifact reference.

ElevenLabs does not document idempotency for these operations. Workers disable SDK retries and checkpoint before each paid request. If a request is interrupted without a saved result, it becomes `needs_review`; resuming does not repeat the paid call. If the result receipt exists, recovery can finish publication without another provider call. Progress represents queued, processing, saving, and completed stages, not provider-reported percentages. A conflicting result remains stored for review. The original WAV and all earlier composition/audio versions remain intact.

## API

Authenticated endpoints accept either the hosted browser session or `Authorization: Bearer <JWT>` for external clients. Cookie-authenticated mutations require the exact app Origin. Account signup/sign-in, signed Blob callbacks and the separately authenticated worker have their own checks.

| Route | Purpose |
| --- | --- |
| `POST /api/accounts` | Sign up with `{username, password}` and begin a session |
| `GET/POST/DELETE /api/session` | Check the account, sign in with `{username, password}`, or revoke the session |
| `POST /api/chat`, `POST /api/lyrics` | Authenticated BYOK generation; credentials are used for this request only |
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

## Browser accounts

Apply migration `003_web_accounts.sql` before deploying this version. Set
`APP_ORIGIN` to the public HTTPS origin, and keep PostgreSQL private. Accounts
use case-insensitive usernames with 3–32 ASCII letters, numbers or underscores,
and passwords with 12–128 characters. Passwords use individually salted scrypt
hashes. Session tokens expire after 12 hours, are stored only as hashes in the
database, and are replaced on sign-in. Database counters throttle login and
signup across server instances. Back up PostgreSQL along with the private Blob
store; both contain durable user data.

`BANGER_WEB_PASSWORD`, `BANGER_WEB_USER`, access-fragment URLs, and
`BANGER_SESSION_SECRET` no longer grant browser access. Existing shared-workspace
data remains owned by its previous user ID. To assign it to an account, a trusted
database administrator must first verify the owner and sign up that account,
then revoke its sessions and change its `web_accounts.user_id` to the existing
owner ID in a transaction. Never assign the old workspace to the first signup.
There is no email verification or self-service password recovery in this
username-only flow.

BYOK chat and lyric requests go through the same-origin authenticated API.
Provider endpoints are fixed by the provider adapter; clients cannot supply a
proxy destination. Keys are not saved in the server database or logged. Browser
keys remain in account-scoped tab storage and are cleared on sign-out.

## Hosted studio projects and storage

The hosted entry point installs web implementations of the existing workspace,
music, song-storage and library interfaces. Open Project, Create New Project,
Save, project chat, Vocal Studio and library exports use the signed-in account.
The separate cloud-source editor is hidden in the hosted app. The static export
and Electron continue to use their existing adapters.

Apply all migrations before updating the app. Projects, source revisions, lyric
drafts, conversation history and library metadata use PostgreSQL. Project chat
runs the same bounded file-tool agent in a temporary directory. It restores
conversation history, streams activity, revalidates writes and checks source
revisions before publication. Conflicting edits remain unchanged in the saved
project and the task reports incomplete. Account-bound request headers prevent a
stale tab from applying another account's credentials after sign-in changes.

For Vercel, use the private Blob store for audio. For a self-hosted Node server,
set `BANGER_LOCAL_DATA_DIR` to an absolute directory on persistent disk. The API
stores media there with private permissions and streams it only after project
authorization. The app uploads directly to that server with a 100 MiB bound.
This directory must be shared by every server/worker instance and backed up
alongside PostgreSQL. Do not point it at a public directory or ephemeral
serverless filesystem. Leave it unset on Vercel. Changing storage backends does
not migrate existing audio.

The local renderer check uses a dedicated database and local media directory:

```sh
NODE_ENV=production DATABASE_URL=postgresql://localhost/banger_test \
  APP_ORIGIN=http://127.0.0.1:3048 BANGER_LOCAL_DATA_DIR=/tmp/banger-test-media \
  pnpm --filter @banger/api exec next start --hostname 127.0.0.1 --port 3048
# In another terminal, after building and migrating:
pnpm --filter @banger/desktop exec electron ../api/scripts/smoke-accounts.cjs --projects
```

This check exercises account flows, project creation and reload, source saves,
draft persistence, real WAV rendering, private uploads, library persistence and
non-silent playback. It does not call a paid provider.

For hosted vocal and Full Send checks, start that local server with the test-only
provider preload (absolute path from the repository root):

```sh
NODE_OPTIONS="--import=$PWD/apps/api/test/fixtures/providers.mjs" \
  NODE_ENV=production DATABASE_URL=postgresql://localhost/banger_test \
  APP_ORIGIN=http://127.0.0.1:3048 BANGER_LOCAL_DATA_DIR=/tmp/banger-test-media \
  pnpm --filter @banger/api exec next start --hostname 127.0.0.1 --port 3048
pnpm --filter @banger/desktop exec electron ../api/scripts/smoke-accounts.cjs --music
pnpm --filter @banger/desktop exec electron ../api/scripts/smoke-accounts.cjs --full-send=beat
pnpm --filter @banger/desktop exec electron ../api/scripts/smoke-accounts.cjs --full-send=lyrics
pnpm --filter @banger/desktop exec electron ../api/scripts/smoke-accounts.cjs --full-send=both
```

The preload accepts only dummy provider keys, returns fixture model/audio
responses, and rejects other external requests. The tests exercise the real
production routes, database, private media storage, provider adapters and shared
renderer. They cover draft fitting, lyric saves, full/selected generation,
version history, vocal exports and permission-scoped Full Send. Never enable
this preload in a deployed server. Live provider access and Vercel Blob still
require deployment-specific validation.

### Library records and artwork

Run migrations before deploying this version. `007_library_records.sql` groups
existing account library songs by project and adds a persistent UUID per record.
The library returns a record ID and name with each song. Cover images are served
through the authenticated `/api/library/:recordId/artwork` endpoint.

Saving audio returns before artwork generation. The client submits its saved
Vercel or Meta key to the artwork endpoint, which schedules generation with
Next.js `after`. Muse Wonder writes the cover brief from the initial project
prompt, score and lyrics; Muse Image renders one square cover with `n=1` and
`size=1024x1024`. Keys and provider errors are not stored. A database lease
prevents simultaneous requests from generating duplicate covers. Library
refresh resumes unfinished work when credentials are available, with at most
three attempts per record. Without a compatible saved key, songs remain usable
without artwork. Paid generation is covered by fixture tests, not live calls.

Desktop projects keep their record UUID in `.banger/record.json`. Exported song
metadata retains this ID, and a shared cover is stored in the user's `records`
directory. Browser folder projects use their persistent project ID and an
IndexedDB records store. Old local exports without project identity remain
individual records because their original project cannot be recovered reliably.
