-- The API connects as tpw_app, which is subject to row-level security. Migrations run as the
-- database owner; the security-definer functions in 002 run as the owner too, so policies can
-- look at tenders and invitations without recursing into their own policies.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tpw_app') THEN
    CREATE ROLE tpw_app LOGIN NOBYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public TO tpw_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO tpw_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO tpw_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO tpw_app;
-- Organisations and users are read by the session layer before a tenant is known.
REVOKE INSERT, UPDATE, DELETE ON organizations, users FROM tpw_app;
