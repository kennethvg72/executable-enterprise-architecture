-- Least privilege (SEC-09). Migrations run as the owner role; the application runs as
-- my_application_app, which Central IT provisions (and db:setup creates in development).
-- Grant exactly what the application does. Rename the role with the application.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'my_application_app') THEN
    GRANT USAGE ON SCHEMA public TO my_application_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON sessions TO my_application_app;
  ELSE
    RAISE NOTICE 'Role my_application_app does not exist; grants skipped.';
  END IF;
END
$$;
