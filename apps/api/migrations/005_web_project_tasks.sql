CREATE TABLE project_lyric_drafts (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 path text NOT NULL,
 draft jsonb,
 retired boolean NOT NULL DEFAULT false,
 PRIMARY KEY(project_id,path)
);
CREATE TABLE web_agent_threads (
 id uuid PRIMARY KEY,
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 user_id text NOT NULL REFERENCES users(id),
 model text NOT NULL,
 history jsonb NOT NULL DEFAULT '[]',
 lease_token uuid,
 lease_until timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now()
);
