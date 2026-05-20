---
name: Postgres Best Practices
description: Postgres performance optimization and best practices — query indexing, connection management, RLS security, schema design, locking, data access patterns, monitoring, and advanced features.
---

# Postgres Best Practices

Apply these when writing SQL, designing schemas, optimizing queries, configuring Postgres, working with RLS, or troubleshooting database performance.

## Query Performance (CRITICAL)

- **Always index WHERE/JOIN columns.** Missing indexes are the #1 performance killer.
- **Use partial indexes** for queries that filter on a subset (`WHERE status = 'active'`).
- **Use composite indexes** for multi-column lookups — column order matters (most selective first for equality, range column last).
- **Use covering indexes** (`INCLUDE`) to avoid heap lookups for frequently queried columns.
- **Choose the right index type:** B-tree (default, most cases), GIN (arrays, JSONB, full-text), GiST (geometry, range), BRIN (append-only time-series).

## Connection Management (CRITICAL)

- **Always use connection pooling** (PgBouncer, Supavisor). Direct connections don't scale.
- **Set idle timeouts** — idle connections consume memory. Use `idle_in_transaction_session_timeout`.
- **Use `transaction` pool mode** for most workloads. `session` mode only when you need prepared statements or advisory locks.
- **Monitor connection counts** — `SELECT count(*) FROM pg_stat_activity;`

## Security & RLS (CRITICAL)

- **Enable RLS on every user-facing table.** `ALTER TABLE t ENABLE ROW LEVEL SECURITY;`
- **Index columns used in RLS policies** — otherwise every row scan evaluates the policy.
- **Use `security definer` functions** sparingly and audit them. They bypass RLS.
- **Grant minimal privileges.** Don't use the `postgres` role in application code.

## Schema Design (HIGH)

- **Use the smallest correct type.** `int` not `bigint` when values fit, `text` not `varchar(255)`.
- **Add constraints at the DB level.** `NOT NULL`, `CHECK`, `UNIQUE` — don't rely on app validation alone.
- **Use UUIDs as primary keys** for distributed systems; `bigserial` for single-instance.
- **Always index foreign keys.** Unindexed FKs cause full table scans on parent DELETE/UPDATE.
- **Use lowercase identifiers.** Avoid quoted identifiers — they're case-sensitive and error-prone.
- **Partition large tables** (100M+ rows) by range (time) or list (tenant).

## Concurrency & Locking (MEDIUM-HIGH)

- **Keep transactions short.** Long transactions hold locks and block vacuum.
- **Prevent deadlocks:** always acquire locks in a consistent order.
- **Use `SKIP LOCKED`** for job queue patterns — avoids contention.
- **Use advisory locks** for application-level mutual exclusion.

## Data Access Patterns (MEDIUM)

- **Use keyset (cursor) pagination** instead of `OFFSET` — `WHERE id > $last_id ORDER BY id LIMIT 20`.
- **Batch inserts** with `INSERT INTO ... VALUES (...), (...), (...)` or `COPY`.
- **Avoid N+1 queries.** Use JOINs or batch lookups (`WHERE id = ANY($1)`).
- **Use `ON CONFLICT` (UPSERT)** instead of check-then-insert patterns.

## Monitoring & Diagnostics (LOW-MEDIUM)

- **Use `EXPLAIN ANALYZE`** to understand query plans. Look for Seq Scans on large tables.
- **Enable `pg_stat_statements`** to find slow queries.
- **Monitor autovacuum.** Dead tuples bloat tables and slow queries.

## Advanced Features

- **Full-text search:** Use `tsvector` + `GIN` index instead of `LIKE '%term%'`.
- **JSONB indexing:** Use `GIN` index with `jsonb_path_ops` for containment queries.
