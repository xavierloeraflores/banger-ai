-- Small immutable source files live beside their revision metadata. Audio stays
-- in the private object store; old Blob-backed source revisions remain readable.
CREATE TABLE project_source_objects (
 pathname text PRIMARY KEY,
 source text NOT NULL CHECK (octet_length(source) <= 4194304),
 created_at timestamptz NOT NULL DEFAULT now()
);
