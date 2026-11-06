---
name: genie-space
description: Build, publish and wire up a Databricks Genie (AI/BI) space from code - instructions, example SQL, benchmarks, entity matching - and call it from an app with follow-up conversations and per-question context. Use when creating or updating a Genie space, embedding Genie in an app, or debugging Genie answers.
---

# Genie space as code, and Genie inside an app

## Define the space in code

[genie/spec.py](../../../genie/spec.py) is the single source: `TITLE`, `DESCRIPTION`, `TABLES`, `ENTITY_COLUMNS`
(columns with entity matching, e.g. operator names), `TEXT_INSTRUCTIONS`, `EXAMPLES` (question + SQL pairs),
`FILTERS` / `MEASURES` (SQL snippets), `BENCHMARKS` and `SAMPLE_QUESTIONS`. It was written from `ref/Genie.md` and
`ref/sbx_prompts.txt`.

What made answers good:
- Instructions that state the domain rules (here: CNRL is BA ID `0HE9`, filter on IDs never names; production =
  `ActivityID = 'PROD'`; STRING columns need `try_cast`; units).
- Pre-computed, typed tables for the app's concepts (`shm_hack.acq.*`) listed first, so Genie prefers them over raw tables.
- An instruction explaining the app's **"Map context" block** (see below), so Genie filters on the IDs it carries.
- Example SQL for the questions people actually ask.

## Publish

[scripts/genie_space.py](../../../scripts/genie_space.py) turns the spec into Genie's `serialized_space` (version 2,
items sorted by id, ids are stable md5 hashes so re-publishing updates items instead of duplicating them) and
creates or PATCHes the space via `/api/2.0/genie/spaces`.

```bash
.venv/Scripts/python scripts/genie_space.py --validate     # run every example + benchmark SQL on the warehouse first
.venv/Scripts/python scripts/genie_space.py --print        # inspect the serialized JSON
# publish to a given workspace; each workspace keeps its own space id file:
DBX_PROFILE=dakota DBX_WAREHOUSE=05b87f6842570f60 DATABRICKS_CONFIG_PROFILE=dakota \
GENIE_ID_FILE=app/genie_space.dakota.json .venv/Scripts/python scripts/genie_space.py
```

The space id lands in the id file; put it in `databricks.yml` (`genie_space_id` variable) and the app env `GENIE_SPACE_ID`.
Genie spaces are workspace objects: a new workspace needs its own space.

## Call it from an app

[app/backend/genie.py](../../../app/backend/genie.py), `ask(question, conversation_id, context)`:
- no `conversation_id` → `w.genie.start_conversation_and_wait(space_id, content)`
- with one → `w.genie.create_message_and_wait(space_id, conversation_id, content)` (follow-ups keep context)
- rows → `w.genie.get_message_attachment_query_result(...)`; attachments carry `text`, `query` (SQL + description)
  and `suggested_questions`.

How the memory works and how to reuse the pattern: [.claude/docs/genie-conversation-memory.md](../../docs/genie-conversation-memory.md).

**Per-question context**: UI selections are sent as a plain-text block before the question
(`"Map context …\n- Selected CNRL facilities (12): …\n\nQuestion: …"`), with capped lists (40 facilities, 15
operators, 40 wells). The space instructions say how to use it.

**Identity**: the deployed app calls Genie as its service principal (`genie_space` resource, CAN_RUN), so viewers need
no Genie permission for the in-app chat. A direct "Open in Databricks" link only works for people the space is shared with.

## Presenting answers well (GeniePanel.tsx)

- Genie returns raw SQL column names: humanise them (`liq_m3km_saved` → "Liquids m³·km saved", `pct`/`share` → %).
- Show one-row results as a label/value list, not a wide table.
- Fractions in share/decline/rate columns → percentages; columns named `*_pct` are already percentages.
- Scroll the latest question to the top when an answer arrives, not to the bottom.
- Genie's suggested follow-ups often reword the last question; only near-verbatim repeats can be filtered safely.

## Expect

20–60 s per answer; large context blocks push it toward a minute. Check numbers against the data when they matter
(we verified a Grizzly brief: figures right, reasoning on transport savings shallow; it also listed facilities by ID
and merged queries into a "Section | Col1 | Col2" table).
