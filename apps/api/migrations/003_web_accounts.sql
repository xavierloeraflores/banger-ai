CREATE TABLE web_accounts (
 user_id text PRIMARY KEY REFERENCES users(id),
 username text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_]{3,32}$'),
 password_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE web_sessions (
 token_hash text PRIMARY KEY,
 user_id text NOT NULL REFERENCES web_accounts(user_id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX web_sessions_expiry ON web_sessions(expires_at);
CREATE TABLE web_auth_limits (
 bucket text PRIMARY KEY,
 attempts integer NOT NULL,
 expires_at timestamptz NOT NULL
);
