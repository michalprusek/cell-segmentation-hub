<!--
Delete any section that does not apply. The point of this template is the
Verification block: green types and green lint are not evidence that a change
works, and shipping on them is the failure mode this project keeps hitting.
-->

## What changed

<!-- One or two sentences. What behaviour is different after this PR? -->

## Why

<!-- The bug, the request, or the measurement that motivated it. Link the issue
     or paste the symptom. -->

## Verification

<!-- Not "TypeScript compiles". The runtime path that uses this change has to
     have been OBSERVED working. Tick what you actually did and paste the
     evidence — a screenshot, the curl output, the log line, the query result. -->

- [ ] `make ci` (TypeScript + ESLint at 0 warnings + i18n + doc links + Python)
- [ ] `npx vitest run` — `make ci` does **not** run it; the required `frontend`
      and `backend` CI jobs do
- [ ] Backend tests, in the container (canvas ABI — see `docs/testing-guide.md`)
- [ ] **UI change**: opened it in a real browser, screenshotted it, and checked
      the console is clean
- [ ] **API change**: curled the endpoint and confirmed the field is on the wire
      (the database is not the API — fields get stripped on the read path)
- [ ] **Cross-stack change**: walked the whole user journey end to end
- [ ] **Build/dependency change**: `make build-service SERVICE=<name>` succeeds
      and the production bundle was clicked through
- [ ] **Bug fix**: reverted the fix and confirmed the new test goes red, then
      restored it

<!-- Paste the evidence here. -->

## Risk / rollback

<!-- What could this break, and how would you back it out? Note explicitly if a
     migration, a model weight, or a deploy-order dependency is involved
     (ML before backend, nginx restart after a backend recreate). -->

## Follow-ups

<!-- Anything deliberately left out of scope. -->
