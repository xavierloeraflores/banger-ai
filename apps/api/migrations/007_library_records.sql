ALTER TABLE projects ADD COLUMN original_prompt text;
CREATE TABLE library_records (
 id uuid PRIMARY KEY,
 user_id text NOT NULL REFERENCES users(id),
 project_id uuid NOT NULL REFERENCES projects(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
 context jsonb NOT NULL DEFAULT '{}',
 artwork text,
 attempts integer NOT NULL DEFAULT 0,
 lease_token uuid,
 lease_until timestamptz,
 UNIQUE(user_id,project_id),
 CHECK(artwork IS NULL OR length(artwork) <= 7000000)
);
INSERT INTO library_records(id,user_id,project_id,name)
SELECT gen_random_uuid(),l.user_id,l.project_id,left(p.name,160) FROM library_entries l JOIN projects p ON p.id=l.project_id GROUP BY l.user_id,l.project_id,p.name;
ALTER TABLE library_entries ADD COLUMN record_id uuid REFERENCES library_records(id);
UPDATE library_entries l SET record_id=r.id FROM library_records r WHERE l.user_id=r.user_id AND l.project_id=r.project_id;
ALTER TABLE library_entries ALTER COLUMN record_id SET NOT NULL;
CREATE INDEX library_entries_record ON library_entries(record_id);

UPDATE library_records r SET context=jsonb_strip_nulls(jsonb_build_object('name',r.name,'prompt',p.original_prompt,'source',l.beat->>'source','lyrics',l.lyrics::text))
FROM projects p, library_entries l WHERE l.id=(SELECT id FROM library_entries WHERE record_id=r.id ORDER BY created_at LIMIT 1) AND p.id=r.project_id;
