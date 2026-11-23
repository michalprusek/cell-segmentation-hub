# Documentation is part of the change

Where documentation lives, the check before calling a change done, and what to do when docs and code disagree.

> Moved verbatim from `CLAUDE.md` (as of `github/main` `760d64b0`) on 2026-11-02, to keep that file under 200 lines; brought up to `github/main` #644 on 2026-11-23. Code comments that say "see CLAUDE.md" may mean this page.

**Every application change updates the documentation that describes it, in the
same PR, and the update is VERIFIED the same way the code is.** Docs that
describe a UI which no longer exists are worse than no docs: a reader follows
them, cannot find the control, and concludes the feature is broken.

This is not a style preference. Documentation here lives in four places that
drift independently, and a change usually touches more than one:

1. **`docs/**.md`** — architecture, reference, API, testing guide.
2. **The in-app Documentation page** (`src/pages/documentation/`) — what USERS
   read. It is rendered from the `docs:` block in
   `src/translations/{en,cs,es,de,fr,zh}.ts`, so a change here is a change in
   SIX files. Note there are TWO blocks named `modelSelection` in those
   files — one under `settings:`, one under `docs:` — and editing the wrong one
   is easy.
3. **`docs/claude/<area>.md`** — every "X lives at Y" claim about that area.
   `CLAUDE.md` holds only rules, summaries and pointers: it is loaded into
   every agent session, so detail added there costs every task. Put new detail
   in the matching `docs/claude/` page and, if it is a rule, one line in
   `CLAUDE.md`.
4. **Code comments carrying measured numbers** — see the rule about not
   "simplifying" `rasterize_band`, `vicinity_mask` and `focus_qc/metrics.py`.

### The check, before you call a change done

- `grep` the docs for the names of everything you deleted, moved or renamed —
  components, routes, URL query params, settings tabs, env vars, endpoints.
  A deleted `ModelSettingsSection` or a removed `?tab=models` leaves prose
  pointing at it.
- If the change is user-visible, **open the in-app Documentation page in the
  browser** and read the section that covers it, exactly as a user would. The
  i18n validator cannot tell you a sentence became false — it only checks that
  keys exist in all six files.
- If a doc states a NUMBER (a default, a threshold, a count, a duration),
  re-measure it rather than copying it forward. This repo's own comments have
  been wrong by seven minor versions.
- State in the PR description which docs you checked, including the ones you
  concluded needed no change. "I did not look" and "I looked and it was fine"
  are different answers.

### When docs and code disagree

Fix the docs to match the code only after confirming the CODE is right. The
`_arc_length_resample_polyline` case is the precedent: the docstring cited the
wrong ImageJ method for years, and the code was correct — "fixing" the code to
match the comment would have been the bug.
