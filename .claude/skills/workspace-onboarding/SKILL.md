---
name: workspace-onboarding
description: Stand the app up in another Databricks workspace - CLI profile login, warehouse access, catalog access, a dedicated Lakebase project, a new Genie space, a new bundle target and sharing. Use when asked to move, copy or deploy the app to a different workspace, or when a new workspace setup is blocked on permissions.
---

# Bring the app to a new Databricks workspace

Order matters: each step needs the one before. This is what we did to stand up `acquisition-app` in the dakota
workspace. (`SETUP-NEW-WORKSPACE.md` in the repo root is a longer from-scratch guide written by a teammate.)

## 1. Sign in as yourself

```bash
databricks auth login --host https://adb-<id>.<n>.azuredatabricks.net --profile <name>
databricks -p <name> current-user me        # confirm the user: we once landed on a shared demo account
```

## 2. Check data and compute access (usually the blocker)

- **Catalog**: Unity Catalog metastores can be shared between workspaces; `shm_hack` was readable from both.
  Test with `DBX_PROFILE=<name> DBX_WAREHOUSE=<id> python scripts/sql.py` and a `SELECT count(*)`.
- **SQL warehouse**: you need CAN_USE on one. If `warehouses list` shows nothing usable, ask an admin. What worked
  for us: the admin granted it with the Permissions API (`/api/2.0/permissions/warehouses/<id>`, `CAN_USE` for the
  user). The ⋮ menu on the warehouse's detail page had no Permissions item.
- Look at how existing apps in the workspace are configured (`databricks apps list -p <name>`, their resources) before
  inventing your own setup.

## 3. Database: create your own

Create a dedicated Lakebase Autoscaling project for the app, not a table in someone else's database (we nearly used
a shared `governance-db`). Ask the user first. Steps: `lakebase-setup` skill.

## 4. Genie space

Publish a new space with a per-workspace id file (`GENIE_ID_FILE=app/genie_space.<name>.json`). Steps: `genie-space` skill.

## 5. Bundle target

Add a target to `databricks.yml` with the workspace host, variables (`genie_space_id`, `warehouse_id`), a
workspace-appropriate app `name`, `config.env` (`LAKEBASE_ENDPOINT`, `GENIE_SPACE_ID`), resources and
`permissions`. Keep the bundle name and resource key unchanged. Deploy: `databricks-app-deploy` skill.

## 6. Grant, verify, share

1. `load_lakebase.py` with `APP_NAME=<app>` to load the tables and grant the app's service principal.
2. Verify: `verify-deployed-app` skill.
3. Share: `users` CAN_USE in the bundle's `permissions`.
4. Record the new target in `CLAUDE.md` so later sessions know about it.

## Ask before

Creating schemas, Lakebase projects/databases, Genie spaces or apps; granting permissions; using an account that
isn't the user's own.
