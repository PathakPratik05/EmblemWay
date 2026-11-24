-- EmblemWay: executed once when the Postgres volume is first initialised.
-- Creates the test database and enables PostGIS in both databases.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

SELECT 'CREATE DATABASE emblemway_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'emblemway_test')\gexec

\connect emblemway_test
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
