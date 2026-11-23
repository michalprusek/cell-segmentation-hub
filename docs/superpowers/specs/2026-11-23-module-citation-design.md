# Per-module citation on the welcome page — design

Chosen by the owner 2026-11-23 (option "toggles, published modules only").
Short design (a small change).

## Intent

Each segmentation module's trained models get their own Zenodo record whose
creators include the people who provided and annotated the training data, so a
citation of the module also counts for them. The first one is published:
**Sperm**, doi:10.5281/zenodo.24415067 (v1.0.0, concept DOI
10.5281/zenodo.24415066). The welcome page's "How to cite" must let a reader
add the module they used to the citation.

## Goals

- The CMPB platform paper stays shown, always — the record itself asks to be
  cited "together with the SpheroSeg platform paper".
- Below it, one toggle per module that HAS a published record. Nothing is
  selected by default; the reader picks what they want to cite. Several can be
  selected at once.
- A selected module adds its reference (with a DOI link) and its BibTeX entry.
  "Copy BibTeX" copies the paper plus every selected module, in a fixed order.
- A licence obligation travelling with a record is shown with its reference
  (sperm: the weights are a DINOv3 derivative; publications must acknowledge
  DINOv3 — from the record's README and LICENSE).
- Adding the next module is one entry in `src/lib/citation.ts`, no UI work.

## Non-goals / anti-goals

- No placeholder for modules without a record: the page must not promise a
  citation that does not exist yet.
- No persistence of the selection (default must stay "none").
- Not the export ZIP's CITATION file — separate, later.

## Decisions

- **The versioned DOI (…067), not the concept DOI.** The deployed files are
  byte-identical to v1.0.0 (SHA-256 of both checked 2026-11-23 against the
  record's `SHA256SUMS`). A new version of the weights changes one constant.
- **BibTeX entry type `@misc` with `howpublished = {Zenodo}` and `version`**,
  not Zenodo's own `@software` + `publisher` export. Measured by typesetting
  both in plainnat, elsarticle-num, IEEEtran, unsrt and biblatex
  (numeric, authoryear) in TeX Live 2026: classic BibTeX does not know
  `@software` (warning, falls back to misc) and misc never prints `publisher`,
  so Zenodo's export loses "Zenodo" in all six styles — biblatex included.
  `@misc` + `howpublished` shows it in all six with no warning; biblatex also
  prints the version; classic styles do not, and the versioned DOI identifies
  it there. A `note = {Version …}` was rejected: biblatex prints it twice.
- Diacritics LaTeX-escaped, as in the paper's entry.
- **A record's fields are stated once** and both the reference and the
  BibTeX are generated from them (review of #652: a hand-written BibTeX
  string beside the fields would drift when the weights get a new version).
  `latexEscape` decomposes each letter (NFD) into base + one combining mark
  and THROWS on anything it cannot escape rather than writing a wrong name.
  The generated sperm entry is pinned byte for byte to the one first shipped
  and typeset.
- "Version" in the on-page reference is not translated: a reference is text
  copied into a manuscript, in the citation's language (DataCite's own APA
  rendering of the record reads "(Version 1.0.0)"), like the journal name.
- One record per module (project type), enforced by a test: a second record
  for one type would need a label of its own, so it must be a decision.
- Module label = the project-type name (`projects.types.<type>`), the existing
  single source of that name.

## Added 2026-11-23 (owner's decisions)

- **Three records**: SpheroidSeg (spheroid, doi:10.5281/zenodo.24439099),
  ScratchSeg weights (wound, doi:10.5281/zenodo.24416067) and SpermSeg (sperm,
  doi:10.5281/zenodo.24415067, renamed from "SpheroSeg sperm morphology
  models…" on Zenodo). The ScratchSeg DATASET (…24416065) is not offered.
  All deposited model files have the MD5 of the deployed ones.
- **What a record asks to be cited with it goes into the BibTeX too**
  (owner's choice over a note or a link): SpheroidSeg → the three external
  datasets inside SpheroMix (Blondeel 2025, Lacalle 2021, García-Domínguez
  2024; Crossref metadata); ScratchSeg → the ICIP 2026 workshop paper as the
  record gives it, with no DOI until the proceedings are out (elsarticle-num
  warns "empty pages" for it until then). A work two modules share is written
  once. The page shortens author lists past six to "et al." (Vancouver); the
  BibTeX never does.
- **"Other module / SpheroSeg as a whole"**: some modules will never get a
  record. A last toggle explains that such a module is cited through the
  paper, which is always in the BibTeX; it adds nothing to it (owner's choice
  over a permanently visible sentence).

## Approaches considered

1. **Toggles for published modules only** — chosen.
2. All seven modules, missing ones disabled ("in preparation") — rejected:
   promises records that do not exist and needs a UI edit per publication.
3. A single-choice dropdown with "— none —" — rejected: a study using two
   modules would copy twice, and "none" is an extra fake option.
