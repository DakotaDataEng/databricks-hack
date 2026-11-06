---
name: verify-deployed-app
description: Check a live Databricks App end to end before sharing it - call its API with a CLI OAuth token (the browser can't sign in), ask Genie through it, read app logs, permissions, deployment state and the Lakebase endpoint. Use after a deploy, before sending the app to people, or when the live app misbehaves.
---

# Verify a deployed Databricks App

The integrated browser can't complete the workspace's Entra sign-in, so test the live app through its API with your
CLI token. Requests then run exactly as the app runs them (same backend, same service principal for data and Genie).

```bash
TOKEN=$(databricks auth token -p dakota | python -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
U=https://acquisition-app-309407444942385.5.azure.databricksapps.com
curl -s -H "Authorization: Bearer $TOKEN" $U/api/health                 # {"ok":true}
curl -s -H "Authorization: Bearer $TOKEN" $U/ | grep -o "<title>[^<]*</title>"
```

## What to check (and what passed on 2026-11-06)

| Check | How | Expect |
|---|---|---|
| Data | `GET /api/facilities`, `/api/assumptions`, `/api/precedents` | 25,316 facilities; 34 assumption keys; 7 deals |
| Ranking | `POST /api/rank` with `{"overrides": {}}` and `{"overrides": {"price_basis": "mix"}}` | 121 candidates; the top changes with pricing |
| Lasso search | `POST /api/nearby` with `cnrl_ids`, `radius_km`, `mode` (`radius`/`knn`), `k`, `window` (`2025`/`last3`) | facilities + operators |
| Details | `GET /api/facility/<id>`, `/api/facility/<id>/wells` | names, wells |
| Genie | `POST /api/genie/ask` `{question, conversation_id: null, context: null}`, then a follow-up with the returned `conversation_id` | same conversation id; 20–60 s each |
| New build is live | grep the served JS bundle for a string you just added | found |
| App state | `databricks apps get <app> -p <profile> -o json` | `app_status RUNNING`, `active_deployment SUCCEEDED` |
| Logs | `databricks apps logs <app> -p <profile> --tail-lines 200` and grep for `error\|exception\|traceback\|500` | nothing |
| Access | `databricks apps get-permissions <app> -p <profile>` | `users` CAN_USE |
| Lakebase | `databricks postgres get-endpoint <endpoint> -p <profile> -o json` | `ACTIVE` (or `IDLE` when scaled to zero) |
| Git | `git status`, `git log -1` | main matches what's deployed |

Note: `/api/rank` takes `{"overrides": {...}}`. A bare `{"price_basis": "mix"}` is silently ignored and returns the
default ranking. Check `assumptions.price_basis` in the response.

## Scale-to-zero test

The first request after the Lakebase endpoint suspends is the risky one (dead pooled connections). To test it, leave
the app **completely idle** for longer than the suspend timeout (5 min + margin), confirm the endpoint state, then load
`/api/facilities`. It only works when nobody, including you in a browser tab or a local backend on the same database,
is using the app.

## Before you tell people it's ready

Mention anything you couldn't verify (for example a Genie space's own sharing, which the permissions API returned
Not Found for) rather than implying it's fine.
