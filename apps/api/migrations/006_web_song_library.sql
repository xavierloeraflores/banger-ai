CREATE TABLE song_audio_history (
 project_id uuid NOT NULL REFERENCES projects(id),
 path text NOT NULL,
 artifact_id uuid NOT NULL REFERENCES artifacts(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,path,artifact_id)
);
CREATE TABLE library_entries (
 id uuid PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id),
 project_id uuid NOT NULL REFERENCES projects(id),
 artifact_id uuid NOT NULL REFERENCES artifacts(id),
 name text NOT NULL,
 scope text NOT NULL CHECK(scope IN ('global','project')),
 beat jsonb,
 lyrics jsonb,
 song_type text NOT NULL CHECK(song_type IN ('instrumental','vocal')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX library_entries_user ON library_entries(user_id,created_at DESC);
