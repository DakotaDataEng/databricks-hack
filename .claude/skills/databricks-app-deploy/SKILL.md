---
name: databricks-app-deploy
description: Deploy or redeploy a FastAPI + React app to Databricks Apps with an Asset Bundle (databricks.yml) - per-workspace targets, app resources (Lakebase, Genie space, warehouse), permissions, and checking the live app. Use when asked to deploy, push to Databricks, update the app, add a workspace target, or share the app with people.
---

# Deploy a Databricks App with an Asset Bundle

This repo's app (`app/`) is a FastAPI backend that also serves the built React frontend. It's deployed by
`databricks.yml` with one **target per workspace**:

| Target | Workspace | CLI profile | App name | Data |
|---|---|---|---|---|
| `prod` (default) | adb-7808899982160538 (hackathon) | `hack` | `cnrl-acquisition-explorer` | Lakebase instance `cnrl-acq` |
| `dakota` | adb-309407444942385 | `dakota` | `acquisition-app` | Lakebase Autoscaling project `acquisition-app` |

## Deploy (every time)

```bash
cd app/frontend && npm run build && cd ../..          # dist/ is gitignored but synced (sync.include in databricks.yml)
databricks bundle validate -t dakota -p dakota        # optional, catches config errors
databricks bundle deploy   -t dakota -p dakota        # create/update the app, upload ./app, apply permissions
databricks bundle run cnrl_acquisition_explorer -t dakota -p dakota   # deploy the uploaded source and (re)start
```

`bundle deploy` only uploads; `bundle run` makes the new code live. Run the tests first
(`.venv/Scripts/python -m pytest -q`) and commit/push only when asked.

## How databricks.yml is laid out

- Top-level `resources.apps.<key>` holds what every target shares (`source_code_path: ./app`, description).
- Each target overrides `name`, `config` (command and env) and `resources` (what the app's service principal can use).
- **Don't rename `bundle.name` or the resource key** (`cnrl_acquisition_explorer`). Renaming orphans the existing
  deployment's state and the bundle tries to create a second app. Change the per-target `name` instead.

App resources and what each grants the app's service principal (SP):

```yaml
resources:
  - name: postgres                      # Lakebase Autoscaling (provisioned instance: `database:` with instance_name/database_name)
    postgres:
      branch: projects/<project>/branches/production
      database: projects/<project>/branches/production/databases/<db>
      permission: CAN_CONNECT_AND_CREATE
  - name: genie-space
    genie_space: { name: <label>, space_id: ${var.genie_space_id}, permission: CAN_RUN }
  - name: sql-warehouse                 # needs CAN_MANAGE on the warehouse to attach; leave out if you only have CAN_USE
    sql_warehouse: { id: ${var.warehouse_id}, permission: CAN_USE }
```

Env the app reads: `LAKEBASE_ENDPOINT` (Autoscaling) or `LAKEBASE_INSTANCE` (provisioned), `GENIE_SPACE_ID`.
In the app runtime the Postgres resource injects `PGHOST`/`PGDATABASE`/`PGUSER` and the SP's credentials.

## Who can open the app

Keep permissions in the bundle so redeploys don't wipe them:

```yaml
permissions:
  - group_name: users        # everyone in the workspace
    level: CAN_USE
```

Viewers need **only** CAN_USE on the app: the app reads Lakebase and runs Genie as its own SP. Check with
`databricks apps get-permissions <app> -p <profile>`. Non-admins can't read other people's apps' permissions
("does not have apps.ruleSets/get"), so ask an admin or look in the UI.

## After a deploy

1. Grant the SP read access to the Lakebase tables (first deploy, and after every data reload):
   `APP_NAME=<app> LAKEBASE_ENDPOINT=... .venv/Scripts/python scripts/load_lakebase.py --grant-only` (see the `lakebase-setup` skill).
2. Verify the live app with the `verify-deployed-app` skill (the browser can't sign in; use a CLI token).

## Gotchas we hit

- **Blank basemap in the production build** ("Worker failed to load"): MapLibre's worker must ship as an asset.
  `import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'` + `setWorkerUrl(workerUrl)`, and the backend
  must serve `.mjs` with a JavaScript mimetype.
- **Warehouse resource fails to attach**: you need CAN_MANAGE on the warehouse. In the dakota workspace we left it
  out and Genie still answered through the app (verified end to end); if Genie errors on a warehouse, grant the app's
  SP CAN_USE on it.
- **Expired CLI login** (`refresh token is invalid`): `databricks auth login --host <url> --profile <name>`. Make sure
  you sign in as yourself (we once landed on a shared demo account).
- **Windows**: run uvicorn without `--reload` locally; the reloader leaves orphan processes holding the port.
- **App compute bills while running**: `databricks apps stop <app> -p <profile>`.
