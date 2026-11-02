CREATE TABLE music_sessions (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), source_artifact_id uuid NOT NULL REFERENCES artifacts(id),
 revision integer NOT NULL DEFAULT 0, current_version jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX music_sessions_project ON music_sessions(project_id,created_at DESC);
CREATE TABLE music_versions (
 music_id uuid NOT NULL REFERENCES music_sessions(id), revision integer NOT NULL,
 document_path text NOT NULL UNIQUE, document jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(music_id,revision)
);
