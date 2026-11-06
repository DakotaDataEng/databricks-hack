# .claude: project knowledge and reusable skills

Notes and playbooks from building the Acquisition App (Petrinex data → Unity Catalog → Lakebase → FastAPI + React on
Databricks Apps, with a Genie agent). Skills load automatically in Claude Code when a task matches their description;
they're also plain Markdown you can read or copy into another project.

## Skills (`skills/<name>/SKILL.md`)

| Skill | Use it for |
|---|---|
| [databricks-app-deploy](skills/databricks-app-deploy/SKILL.md) | Asset Bundle targets, app resources, deploy/run, permissions, deploy gotchas |
| [lakebase-setup](skills/lakebase-setup/SKILL.md) | Autoscaling project vs provisioned instance, loading UC tables, OAuth connections, grants, scale-to-zero |
| [genie-space](skills/genie-space/SKILL.md) | Genie space as code, publishing, calling Genie from an app, presenting answers |
| [workspace-onboarding](skills/workspace-onboarding/SKILL.md) | Bringing the app to another workspace: login, warehouse access, setup order |
| [verify-deployed-app](skills/verify-deployed-app/SKILL.md) | Checking a live app with a CLI token, Genie through the app, logs, scale-to-zero test |
| [ui-browser-testing](skills/ui-browser-testing/SKILL.md) | Running locally, testing in the integrated browser, driving the map, layout fixes |
| [uc-data-pipeline](skills/uc-data-pipeline/SKILL.md) | SQL via `scripts/sql.py`, rebuilding `shm_hack.acq`, checking numbers |

## Docs

- [docs/genie-conversation-memory.md](docs/genie-conversation-memory.md): how Genie keeps follow-up context (conversation
  IDs, per-question context) and how to apply the pattern to a RAG app's session memory.

## Data

- [data/petrinex-tables.md](data/petrinex-tables.md), [data/joins-and-gotchas.md](data/joins-and-gotchas.md),
  [data/eda-findings.md](data/eda-findings.md): the Petrinex tables, join traps and what the data looks like.
