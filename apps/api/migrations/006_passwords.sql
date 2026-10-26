-- Password sign-in. Users created by single sign-on have no password and can only sign in through
-- the identity provider (or, in a demo deployment, by e-mail alone).
ALTER TABLE users ADD COLUMN password_hash text;
