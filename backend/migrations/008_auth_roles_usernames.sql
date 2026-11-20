ALTER TABLE writer_studio.auth_users DROP CONSTRAINT auth_users_role_check;
ALTER TABLE writer_studio.auth_users ADD CONSTRAINT auth_users_role_check CHECK (role IN ('user','reviewer','admin'));
ALTER TABLE writer_studio.auth_users ADD COLUMN username text UNIQUE CHECK (username=lower(trim(username)));
ALTER TABLE writer_studio.auth_users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE writer_studio.auth_users ADD CONSTRAINT auth_users_identity CHECK (email IS NOT NULL OR username IS NOT NULL);
