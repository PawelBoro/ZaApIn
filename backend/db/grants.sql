-- Least-privilege grants for the application role (data only, no DDL).
-- Run as the admin that owns the tables, after `npm run migrate:prod`:
--   psql "host=... dbname=postgres user=... sslmode=require" -v app_role=zai_app -f db/grants.sql
-- :DBNAME is set by psql to the database you are connected to.
-- Safe to run again.

\set ON_ERROR_STOP on

GRANT CONNECT ON DATABASE :"DBNAME" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
-- USAGE only, no CREATE: the app cannot create tables (PostgreSQL 15+ does not
-- give PUBLIC CREATE on schema public). CREATE ROLE ... LOGIN defaults to
-- NOCREATEDB NOCREATEROLE, so it cannot create databases or roles either.

-- Existing tables and sequences (SERIAL ids need USAGE to call nextval).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- Tables and sequences that later migrations create. Applies to objects
-- created by the role running this script, so run migrations as that role.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
