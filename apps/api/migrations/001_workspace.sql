CREATE TABLE IF NOT EXISTS users (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE projects (
 id uuid PRIMARY KEY, owner_id text NOT NULL REFERENCES users(id), name text NOT NULL,
 revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE project_members (
 project_id uuid REFERENCES projects(id) ON DELETE CASCADE, user_id text REFERENCES users(id),
 role text NOT NULL CHECK (role IN ('viewer','editor')), PRIMARY KEY(project_id,user_id)
);
CREATE TABLE project_revisions (
 project_id uuid REFERENCES projects(id), revision integer NOT NULL, manifest_path text NOT NULL UNIQUE,
 manifest jsonb NOT NULL, author_id text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,revision)
);
CREATE TABLE agent_sessions (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), user_id text NOT NULL REFERENCES users(id),
 base_revision integer NOT NULL, sandbox_id text, status text NOT NULL DEFAULT 'queued', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE artifacts (
 id uuid PRIMARY KEY, project_id uuid NOT NULL, revision integer NOT NULL, user_id text NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK (kind IN ('wav','elevenlabs')), pathname text NOT NULL UNIQUE,
 content_type text NOT NULL, size bigint, status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','ready')),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(project_id,revision) REFERENCES project_revisions(project_id,revision)
);
CREATE TABLE jobs (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), user_id text NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK (kind IN ('agent','elevenlabs')), idempotency_key uuid NOT NULL,
 session_id uuid REFERENCES agent_sessions(id), status text NOT NULL DEFAULT 'queued', stage text NOT NULL DEFAULT 'queued',
 progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100), input jsonb NOT NULL, checkpoint jsonb NOT NULL DEFAULT '{}',
 result jsonb, error text, attempts integer NOT NULL DEFAULT 0, lease_token uuid, lease_until timestamptz,
 available_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,idempotency_key)
);
CREATE INDEX jobs_due ON jobs(available_at,created_at) WHERE status IN ('queued','running');
CREATE INDEX jobs_project ON jobs(project_id,created_at DESC);
CREATE INDEX artifacts_project ON artifacts(project_id,created_at DESC);
CREATE INDEX projects_owner ON projects(owner_id,created_at DESC);
CREATE INDEX members_user ON project_members(user_id,project_id);
