---
name: ui-browser-testing
description: Test and polish the app's React UI in the VS Code integrated browser - run it locally, check layouts at several widths, drive the deck.gl map (lasso, zoom, set view), wait for slow Genie answers, and the layout fixes that worked. Use when reviewing UI/UX, reproducing a screenshot issue, or checking a UI change before deploying.
---

# Testing the app UI in the integrated browser

## Run it locally

```bash
# backend :8000 (no --reload on Windows: the reloader orphans processes)
cd app/backend && DATABRICKS_CONFIG_PROFILE=dakota \
  LAKEBASE_ENDPOINT=projects/acquisition-app/branches/production/endpoints/primary \
  GENIE_SPACE_ID=01f1d9f9c48b178cb928e9721966c1ca ../../.venv/Scripts/python -m uvicorn main:app --port 8000
# frontend :5173 (proxies /api to :8000)
cd app/frontend && npm run dev -- --port 5173 --strictPort
```

Checks before calling a change done: `npx tsc --noEmit -p tsconfig.app.json` (plain `-p .` checks nothing because of
project references), `npx eslint src`, `npm run build`, and `.venv/Scripts/python -m pytest -q`.

## Look at it properly

- Screenshots come back about 815 px wide. For detail, emulate a narrower viewport (1000–1280) instead of the user's 1900.
- Test 1900, 1280 and 1000 widths; 900 and below switches to the stacked mobile layout.
- Read values with `browser_eval` rather than screenshots (computed styles, `scrollWidth` vs `clientWidth` for
  overflow, `elementFromPoint` for what's on top).
- A single `browser_eval` times out at 30 s: poll in short evals (`setInterval`, resolve within ~25 s) when waiting
  for Genie (20–60 s).

## Drive the map

deck.gl takes synthetic pointer events, so a lasso can be drawn from `browser_eval`:

```js
const el = document.querySelector('.map-surface'), r = el.getBoundingClientRect()
const fire = (t, x, y) => el.dispatchEvent(new PointerEvent(t, { bubbles: true, clientX: r.left + x, clientY: r.top + y,
  button: 0, buttons: 1, pointerId: 7, isPrimary: true }))
// pointerdown at the first point, ~10 pointermoves per edge of a box, pointerup at the end
```

- Zoom: dispatch `WheelEvent('wheel', { deltaY: -400, clientX, clientY })` on `.map-surface` (one zoom level per 400).
- Jump to coordinates: temporarily expose `setView` in dev (`window.__TMP_setView = setView`), and remove it afterwards.
- deck.gl zoom uses 512 px tiles: metres per pixel = 78,271 × cos(lat) / 2^zoom.
- Hot reload resets component state (selection, Genie thread); redo the setup after editing.

## Layout fixes that worked here

- **Dropdowns**: two or three options → a segmented toggle; long lists (≈120 operators) → a type-to-search picker.
- **Units inside number fields** ("$" prefix, other units as a suffix), not floating below.
- **Header on one line**: `flex-wrap: nowrap` and progressively hide less important pieces with media queries.
- **Map overlays sized against the map, not the viewport** (the Genie panel shrinks it): `container-type: inline-size`
  on `.map-area` and `@container` rules.
- **Anything that must sit above deck.gl dots** needs its own element with a z-index: deck.gl puts the whole MapLibre
  map (attribution included) under its canvas (`z-index: -1`). We turned off MapLibre's attribution control and render
  our own credit line.
- **Stacked points**: Petrinex coordinates are coarse (25,316 facilities on 7,342 points; up to 36 CNRL facilities on one
  dot). Say "N assets on M dots", list the selection, and mention stacking in hover tips.
- **Selection styling**: dim the unselected rather than drawing heavy rings around the selected.
- **Copy**: headings are short labels ("Top 3 candidates"), not narration; one plain sentence under each.
