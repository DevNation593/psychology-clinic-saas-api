-- Separate migration: Postgres cannot use a new enum value in the transaction that adds it.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MASTER';
