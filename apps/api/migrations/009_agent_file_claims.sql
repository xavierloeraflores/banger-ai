CREATE TABLE agent_file_claims (
 project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
 path text NOT NULL,
 owner_id uuid NOT NULL,
 lease_token uuid NOT NULL,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(project_id,path)
);
CREATE INDEX agent_file_claims_expiry ON agent_file_claims(expires_at);
