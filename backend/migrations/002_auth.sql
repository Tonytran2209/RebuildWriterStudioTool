CREATE TABLE writer_studio.auth_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK (email=lower(trim(email))),
 password_hash text,
 role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
 status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
 email_verified boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE writer_studio.auth_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES writer_studio.auth_users(id) ON DELETE CASCADE,
 family_id uuid NOT NULL,
 access_hash text NOT NULL UNIQUE,
 refresh_hash text NOT NULL UNIQUE,
 access_expires_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auth_sessions_user ON writer_studio.auth_sessions(user_id);
CREATE INDEX auth_sessions_family ON writer_studio.auth_sessions(family_id);
CREATE TABLE writer_studio.auth_tokens (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES writer_studio.auth_users(id) ON DELETE CASCADE,
 purpose text NOT NULL CHECK (purpose IN ('recovery','verification')),
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE writer_studio.auth_audit_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid,
 event text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE writer_studio.auth_rate_limits (
 key text PRIMARY KEY,
 attempts integer NOT NULL,
 expires_at timestamptz NOT NULL
);
