# Genie conversation memory: how follow-up questions work

How the Acquisition App's **Ask Genie** panel keeps context across questions, what that memory covers, and what to copy
into a RAG app's session memory. Code: [app/backend/genie.py](../../app/backend/genie.py) (server) and
[app/frontend/src/components/GeniePanel.tsx](../../app/frontend/src/components/GeniePanel.tsx) (client).

## The short version

The memory lives in **Databricks Genie**, not in our app. Genie stores each conversation server-side (questions,
the SQL it generated, its results). Our app keeps only one thing: the **conversation ID**. Each follow-up is sent
with that ID, so Genie answers it with the earlier turns in view.

```
Browser (GeniePanel)            FastAPI (genie.py)                         Databricks Genie
--------------------            ------------------                         ----------------
Q1, conversation = null  ─────▶ start_conversation_and_wait(space, Q1) ──▶ creates conversation C, answers
          ◀──────────────────── { conversation_id: C, text, sql, rows } ◀──
state: conversation = C
Q2 "for those same 5…", C ────▶ create_message_and_wait(space, C, Q2) ───▶ reads C's history, resolves
          ◀──────────────────── { conversation_id: C, … }               ◀── "those same 5", answers
"New chat" / page reload ─────▶ conversation = null → next question starts a new conversation
```

## The two kinds of context

| | Conversation memory | Per-question context (map selection) |
|---|---|---|
| Where it lives | Genie, server-side, keyed by conversation ID | Built fresh by our backend on every question |
| What's in it | Every earlier question, Genie's SQL and its results | Selected CNRL facility IDs, nearby operators, focused facility, ticked wells, focused operator |
| How it gets to Genie | Implicitly, by sending the conversation ID | Explicitly: a text block prepended to the question (`compose()` → `"Map context …\n\nQuestion: …"`) |
| Lifetime | Until the client drops the ID | One question; the next question carries whatever is selected then |
| Size control | Genie's own | Capped lists: 40 facility IDs, top 15 operators by boe/d, 40 wells (`LIMITS` in genie.py) |

The Genie space's instructions ([genie/spec.py](../../genie/spec.py)) tell Genie what a "Map context" block means and how
to filter on those IDs. That's what makes "these operators" work: the IDs are in the prompt, the meaning is in the
instructions.

## The calls

SDK (`databricks-sdk`, `WorkspaceClient().genie`), as used in `genie.ask()`:

| Step | SDK method | REST equivalent |
|---|---|---|
| First question | `start_conversation_and_wait(space_id, content, timeout)` | `POST /api/2.0/genie/spaces/{space_id}/start-conversation` |
| Follow-up | `create_message_and_wait(space_id, conversation_id, content, timeout)` | `POST /api/2.0/genie/spaces/{space_id}/conversations/{conversation_id}/messages` |
| Result rows | `get_message_attachment_query_result(space_id, conversation_id, message_id, attachment_id)` | `GET …/messages/{message_id}/attachments/{attachment_id}/query-result` |

A Genie message comes back with **attachments**: `text` (the answer), `query` (SQL + a description of what it did) and
`suggested_questions`. `_parse()` flattens them into `{conversation_id, text, sql, sql_description, columns, rows,
row_count, suggested_questions, error}`. The `*_and_wait` methods poll until the message completes (we allow 3 minutes).

The client side is a few lines: `conversation` is React state, set from each answer's `conversation_id`, sent with
the next question, and cleared by **New chat**.

## What we observed (tested 2026-11-06)

- References resolve: "for those same 5" (the operators from the previous answer) and "the first one" (the top row
  of an earlier result) both worked, as did a follow-up on the live app ("how many of those were acquired?").
- Map context and conversation memory combine: a question about "these nearby operators" used the current lasso
  selection while staying in the same conversation.
- Latency is 20–60 s per turn; a large map context (1,792 assets) took about 55 s. Follow-ups are no faster.
- Genie's suggested follow-ups often reword the question just asked. The panel drops near-verbatim repeats
  (word-set Jaccard ≥ 0.85, `sameQuestion()` in GeniePanel); looser matching hid genuinely different questions,
  because word overlap can't tell "trend for the first one" from "trend for CNRL".
- Databricks doesn't document how Genie uses the history internally. Treat reference resolution as behaviour we
  observed, not a contract. Naming the entity ("Tourmaline") is always safer than "that one" deep in a thread.

## Limits of this design

- **Memory is lost on reload.** The ID lives only in page state. Nothing is persisted on our side.
- **One identity for everyone.** The backend calls Genie as the app's service principal, so every user's
  conversations belong to that principal. Sessions are separated only by the conversation ID each browser holds.
- **No ownership check.** The backend accepts any `conversation_id` it's given. A client that sent someone else's ID
  would continue that conversation. Fine for an internal demo; not for anything sensitive.
- **No history in our UI after reload, no listing of past chats, no expiry.** Genie keeps the conversations; we never
  read them back or delete them.

## Carrying this into a RAG app's session memory

In a RAG app you own the memory, so you build what Genie gave us for free. The same split works well:

1. **Server-issued session ID; the client holds only the ID.** Generate it on the first turn (like `start-conversation`),
   return it, and require it on follow-ups. Keep the transcript on the server.
2. **Bind the session to the user.** In a Databricks App the signed-in user arrives in request headers
   (`X-Forwarded-Email`, `X-Forwarded-User`). Store it with the session and reject IDs that belong to someone else.
   This closes the gap in our Genie setup.
3. **Keep conversation memory and per-turn context separate.** History = past turns. Per-turn context = what the user
   has selected *now* (filters, a document, a map selection). Inject per-turn context into the current prompt only,
   capped like `LIMITS`, so it doesn't pile up in history.
4. **Store structured results, not just answer text.** Follow-ups like "those same 5" work because Genie can see the
   previous *result*, not only its prose. Save each turn's retrieved document/chunk IDs (and any entities or rows you
   showed) so the next turn can refer back to them.
5. **Rewrite follow-ups into standalone questions before retrieval.** Use the recent turns to turn "what about the
   first one?" into "What is Tourmaline's 2025 gas trend?", then retrieve with the rewritten question. Store both
   versions; the rewrite is what you debug when an answer goes wrong.
6. **Bound the history.** Keep the last N turns verbatim and summarise older ones (or keep only their entities and
   retrieved IDs), so prompts don't grow without limit.
7. **Persist it.** A small Postgres schema (Lakebase works) survives reloads and lets you list past chats:

   ```sql
   CREATE TABLE chat_session (
     session_id   uuid PRIMARY KEY,
     user_email   text NOT NULL,
     title        text,
     created_at   timestamptz DEFAULT now(),
     last_active  timestamptz DEFAULT now()
   );
   CREATE TABLE chat_turn (
     session_id          uuid REFERENCES chat_session ON DELETE CASCADE,
     turn                int,
     question            text,          -- as typed
     standalone_question text,          -- after rewriting with history
     context             jsonb,         -- per-turn context (selection, filters)
     retrieved_ids       text[],        -- chunks/docs used, for "those" references and audits
     answer              text,
     created_at          timestamptz DEFAULT now(),
     PRIMARY KEY (session_id, turn)
   );
   ```

8. **Define the lifecycle.** "New chat" = new session ID. Expire idle sessions (for example after 30 days) with a
   scheduled delete.
