# Module choice in "How to cite" on the welcome page — design

Owner's decisions, 2026-11-23. Short design (a small change). Earlier
iterations of the same day (a toggle per Zenodo record with the platform paper
always cited, "also cite" works) are in this file's git history; the owner
replaced them with the model below.

## Intent

A reader who used SpheroSeg should cite the work that belongs to the module
they used. Some modules have a work of their own, some never will; those are
cited through the platform paper.

## The model

The reader picks **exactly one** choice (a radio group). Nothing is picked by
default, and nothing is cited until they pick. Each choice cites **exactly one
work — nothing more**:

| Choice                              | Cites                                                                                          |
| ----------------------------------- | ---------------------------------------------------------------------------------------------- |
| Spheroids                           | the SpheroSeg paper, _CMPB_ 286 (2026) 109602, doi:10.1016/j.cmpb.2026.109602                  |
| Wound healing                       | the ICIP 2026 workshop paper (LBDL II), Veškrna et al. — no DOI yet                            |
| Sperm                               | the SpermSeg Zenodo record, doi:10.5281/zenodo.24415067 (v1.0.0) + DINOv3 acknowledgement note |
| Microtubules                        | the MicrotubuleSeg Zenodo record, doi:10.5281/zenodo.24415383 (v1.0.0); MIT, no note           |
| Other module / SpheroSeg as a whole | the SpheroSeg paper                                                                            |

Not cited anywhere: the SpheroidSeg and ScratchSeg Zenodo records, the
ScratchSeg dataset, the datasets inside SpheroMix.

## Decisions

- **The versioned DOI for SpermSeg**, not the concept DOI: the MD5 of both
  deposited files equals that of the deployed weights.
- **A Zenodo record's BibTeX is `@misc` + `howpublished = {Zenodo}`**, not
  Zenodo's own `@software` + `publisher` export. Measured in TeX Live 2026
  (plainnat, elsarticle-num, IEEEtran, unsrt, biblatex numeric/authoryear):
  classic BibTeX does not know `@software` and its misc fallback never prints
  `publisher`, so Zenodo's export drops "Zenodo" in all six styles.
- **Every entry is generated from fields** (`citationBibtex`), the CMPB
  paper's included; its generated entry is pinned byte for byte to the
  hand-written one it replaced. `latexEscape` decomposes each letter (NFD)
  into base + one combining mark and THROWS on anything it cannot escape.
  Hyphenated compounds are case-protected as one word ("{U-Net}"), and so is
  a capital with a digit ("{V16}"). Words are found in the RAW title and
  escaped one by one: bracing after escaping split "DEB\_S4" into
  "{DEB}\{_S4}", an escaped brace to LaTeX.
- The three possible entries were typeset in the five styles: 0 errors; one
  warning, elsarticle-num "empty pages" for the workshop paper until it has
  pages. Add its `doi` when the proceedings are out.
- "Version" in the on-page reference is not translated: it is citation text,
  like a journal name (DataCite renders the record as "(Version 1.0.0)").
- Labels: the project-type names (`projects.types.<type>`) and
  `landing.citation.otherModule`.
- The radio group is Radix `RadioGroup` (arrow keys, `role="radio"`,
  `aria-checked`), styled as the page's chips.

## Approaches considered

1. **Single choice, one work per choice** — chosen by the owner.
2. Several modules at once, platform paper always cited, records' "also cite"
   works added — built first, replaced by the owner.
3. A permanently visible sentence instead of an "other module" choice —
   rejected by the owner in favour of a choice.
