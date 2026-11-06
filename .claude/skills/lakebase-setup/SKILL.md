---
name: lakebase-setup
description: Create and load a Lakebase (Databricks Postgres) database for an app - Autoscaling project or provisioned instance, OAuth-token connections from Python, loading Unity Catalog tables with COPY, granting a Databricks App's service principal, and surviving scale-to-zero. Use when setting up, loading, connecting to or troubleshooting Lakebase.
---

# Lakebase setup for an app

Two kinds of Lakebase, both used in this repo:

| | Lakebase **Autoscaling** project (dakota) | **Provisioned** database instance (hack) |
|---|---|---|
| Name | `projects/acquisition-app` → branch `production` → endpoint `primary` | instance `cnrl-acq` |
| Create | `databricks postgres create-project` | `databricks database create-database-instance` |
| Scales to zero | Yes (we set suspend after 300 s) | No; bills until stopped |
| Token | `w.postgres.generate_database_credential(endpoint=...)` | `w.database.generate_database_credential(request_id=..., instance_names=[...])` |
| Host | `w.postgres.get_endpoint(endpoint).status.hosts.host` | `w.database.get_database_instance(name).read_write_dns` |
| App env | `LAKEBASE_ENDPOINT=projects/<p>/branches/production/endpoints/primary` | `LAKEBASE_INSTANCE=<name>` |

Prefer a **dedicated project per app**; don't put app tables in a shared database someone else owns.
**Ask the user before creating a project, instance or database** (they bill).

## Create an Autoscaling project and database

```bash
databricks -p dakota postgres create-project acquisition-app --json '{"spec": {"display_name": "acquisition-app",
  "default_endpoint_settings": {"autoscaling_limit_min_cu": 0.5, "autoscaling_limit_max_cu": 2, "suspend_timeout_duration": "300s"}}}'

# The database must be created through the API (so the app resource can reference it), and it needs an owner role:
databricks -p dakota postgres create-database projects/acquisition-app/branches/production --database-id acq \
  --json '{"spec": {"postgres_database": "acq", "role": "projects/acquisition-app/branches/production/roles/<your-role>"}}'
```

Errors on the way: `Field 'database' is required` → add `spec.postgres_database`; `spec.role required` → add the role.
The Postgres user is your workspace email.

(Provisioned instead: `databricks -p hack database create-database-instance cnrl-acq --capacity CU_1 --retention-window-in-days 7 --no-wait`;
`load_lakebase.py` creates the database itself.)

## Load tables from Unity Catalog

[scripts/load_lakebase.py](../../../scripts/load_lakebase.py) reads each table's columns from
`<catalog>.information_schema.columns`, maps UC types to Postgres (`DECIMAL` → `numeric`, `STRING` → `text`, …),
drops and recreates the table with a primary key, `COPY`s the rows in, adds indexes, runs `ANALYZE`, then grants the
app. Rows come through the SQL warehouse (`scripts/sql.py`).

```bash
DBX_PROFILE=dakota DBX_WAREHOUSE=05b87f6842570f60 DATABRICKS_CONFIG_PROFILE=dakota \
LAKEBASE_ENDPOINT=projects/acquisition-app/branches/production/endpoints/primary APP_NAME=acquisition-app \
  .venv/Scripts/python scripts/load_lakebase.py              # load + grant
# ... --grant-only                                           # just re-grant the app's SP
```

**Recreated tables lose their grants.** The script re-grants automatically; if the app shows permission errors after a
reload, run `--grant-only`. The grant is to the app's SP client ID (`apps get <app>` → `service_principal_client_id`):
`GRANT USAGE ON SCHEMA public` + `GRANT SELECT ON ALL TABLES IN SCHEMA public`.

## Connect from Python (app backend)

[app/backend/db.py](../../../app/backend/db.py): a `psycopg_pool.ConnectionPool` whose connection class fetches a fresh
OAuth token as the password (tokens are short-lived; we fetch a new one every 30 min and cap the pool's
`max_lifetime` to match, so no connection outlives its token).

```python
pool = ConnectionPool(conninfo, connection_class=OAuthConnection, min_size=1, max_size=5,
                      max_lifetime=TOKEN_TTL_SECONDS, check=ConnectionPool.check_connection, open=True)
```

- **`check=ConnectionPool.check_connection` is essential with scale-to-zero.** When the endpoint suspends, pooled
  connections die (`psycopg.errors.AdminShutdown: terminating connection due to administrator command`). Without the
  check the next request gets a dead connection and fails with a 500. We also retry a query once on
  `psycopg.OperationalError`.
- Register `FloatLoader` for `numeric` so pandas math works (`Decimal` breaks it).
- `sslmode=require`. Locally, use the CLI profile; in the app, the injected `PG*` env vars.

## Day-to-day

- First request after idle takes a few seconds while the endpoint wakes up; the frontend retries its first load once.
- State: `databricks postgres get-endpoint <endpoint> -p <profile> -o json` → `status.current_state` (`ACTIVE`/`IDLE`).
- Provisioned instances bill while running: `databricks -p hack database update-database-instance cnrl-acq stopped --stopped`.
