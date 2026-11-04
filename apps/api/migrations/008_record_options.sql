ALTER TABLE library_records ADD COLUMN regenerate_artwork boolean NOT NULL DEFAULT false;
ALTER TABLE library_records ADD COLUMN artwork_version integer NOT NULL DEFAULT 0;
