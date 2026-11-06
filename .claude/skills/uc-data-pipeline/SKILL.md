---
name: uc-data-pipeline
description: Query Unity Catalog and rebuild the app's derived tables - run SQL through scripts/sql.py on a chosen workspace and warehouse, dry-run or run pipelines/*.sql into shm_hack.acq, and refresh Lakebase afterwards. Use when exploring Petrinex data, checking a number the app or Genie shows, or changing the pipeline.
---

# Unity Catalog SQL and the derived-table pipeline

Read the data docs first: [.claude/data/](../../data/) (`petrinex-tables.md`, `joins-and-gotchas.md`, `eda-findings.md`).
Rules that bite: all data comes from the `shm_hack` catalog; `volumetrics`/`ngl_volumes` are all STRING (`try_cast`);
production is `ActivityID = 'PROD'` only; boe = oil + condensate + raw gas / 6 (NGLs excluded).

## Run SQL

```bash
echo "SELECT count(*) FROM shm_hack.acq.facility_summary" | python scripts/sql.py           # profile hack, warehouse 42b00ac711df45f6
echo "...;; ..." | DBX_PROFILE=dakota DBX_WAREHOUSE=05b87f6842570f60 .venv/Scripts/python scripts/sql.py   # another workspace
```

Statements are separated by `;;`. It uses the Statement Execution API; the warehouse auto-starts. Spark SQL limits we
hit: no `count(DISTINCT …)` in window functions (aggregate in a CTE instead).

## Pipeline

`pipelines/01..06_*.sql` build `shm_hack.acq`: facility base → CNRL footprint (BA ID `0HE9`, legacy vs acquired) →
facility summary (2025 rates, nearest CNRL, haul distances, transport-savings basis) → deal precedents → operator
metrics → assumptions.

```bash
python scripts/run_pipeline.py --dry-run -q "SELECT ... FROM {acq}.<table>"   # read-only check, every table as a CTE
python scripts/run_pipeline.py                                                # rebuild the tables
.venv/Scripts/python scripts/load_lakebase.py                                 # copy to Lakebase (see lakebase-setup)
```

Restart the backend afterwards (it caches the scoring tables per process). Ask before creating schemas.

## Checking a number

To verify something the app or Genie says, query the same table the app uses (`shm_hack.acq.*`) rather than
re-deriving from raw tables. Example from this project: Grizzly's "$0 transport saving" was really about $2,900 a year,
because 84% of its output comes from one battery that already ships 80% of its product to CNRL.
