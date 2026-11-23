import type { ProjectType } from '@/types';

export const doiUrl = (doi: string) => `https://doi.org/${doi}`;

/**
 * The paper to cite for SpheroSeg. Metadata from Crossref for
 * doi:10.1016/j.cmpb.2026.109602 (Computer Methods and Programs in
 * Biomedicine, vol. 286, November 2026, article 109602).
 */
export const SPHEROSEG_PAPER = {
  authors: [
    'Průšek M.',
    'Novozámský A.',
    'Škubník J.',
    'Svobodová Pavlíčková V.',
    'Rimpelová S.',
  ],
  title:
    'SpheroSeg: Advancing tumor spheroid analysis through open-source deep learning',
  journal: 'Computer Methods and Programs in Biomedicine',
  volume: '286',
  articleNumber: '109602',
  year: '2026',
  doi: '10.1016/j.cmpb.2026.109602',
} as const;

export const SPHEROSEG_PAPER_URL = doiUrl(SPHEROSEG_PAPER.doi);

/**
 * Diacritics are LaTeX-escaped rather than UTF-8: classic BibTeX under
 * pdfLaTeX mangles or rejects "ů" and "š", while the escaped form works with
 * every toolchain, biber included. The braces around SpheroSeg keep a style
 * that lower-cases titles from turning it into "Spheroseg".
 */
export const SPHEROSEG_BIBTEX = String.raw`@article{prusek2026spheroseg,
  title   = {{SpheroSeg}: Advancing tumor spheroid analysis through open-source deep learning},
  author  = {Pr{\r{u}}{\v{s}}ek, Michal and Novoz{\'a}msk{\'y}, Adam and {\v{S}}kubn{\'i}k, Jan and Svobodov{\'a} Pavl{\'i}{\v{c}}kov{\'a}, Vladim{\'i}ra and Rimpelov{\'a}, Silvie},
  journal = {Computer Methods and Programs in Biomedicine},
  volume  = {286},
  pages   = {109602},
  year    = {2026},
  doi     = {10.1016/j.cmpb.2026.109602},
  url     = {https://doi.org/10.1016/j.cmpb.2026.109602}
}`;

/**
 * A module's trained models, deposited as their own Zenodo record. Its
 * creators include the people who provided and annotated the training data,
 * so citing the module credits them; the record asks to be cited together
 * with the platform paper, which is why the paper is never replaced.
 */
export interface ModuleCitation {
  /** The project type whose models the record holds; labelled on the page by `projects.types.<projectType>`. */
  readonly projectType: ProjectType;
  readonly authors: readonly string[];
  readonly title: string;
  readonly version: string;
  readonly year: string;
  /**
   * The VERSIONED DOI, not the concept DOI: it names the exact files the
   * application serves. When the deployed weights change, a new Zenodo
   * version is made and this changes with it.
   */
  readonly doi: string;
  readonly bibtex: string;
  /** Translation key of an obligation the record's licence attaches to publications. */
  readonly noteKey?: string;
}

/*
 * BibTeX entry type for a Zenodo record: `@misc` with `howpublished`, NOT the
 * `@software` + `publisher` that Zenodo's own export produces. Measured
 * 2026-11-23 by typesetting both in TeX Live 2026 with plainnat,
 * elsarticle-num, IEEEtran, unsrt and biblatex (numeric, authoryear):
 * classic BibTeX does not know `@software` (a warning, then the misc
 * fallback), and misc never prints `publisher` — so Zenodo's export drops
 * "Zenodo" in all six styles, biblatex included. `@misc` + `howpublished`
 * prints it in all six with no warning. `version` is printed by biblatex only;
 * the classic styles identify the version through the versioned DOI. A
 * `note = {Version …}` would add it there but biblatex then prints it twice.
 */

/**
 * Sperm (`sperm`, `sperm_2part`): doi:10.5281/zenodo.24415067, version 1.0.0,
 * published 2026-11-23; concept DOI 10.5281/zenodo.24415066. Metadata from
 * the record's API. The SHA-256 of both deposited files equals that of the
 * deployed `sperm_final/best_model.pth` and `weights/sperm_2part.pth`.
 */
const SPERM_MODELS: ModuleCitation = {
  projectType: 'sperm',
  authors: [
    'Průšek M.',
    'Novozámský A.',
    'Šroubek F.',
    'Nesnídalová S.',
    'Albrechtová J.',
    'Albrecht T.',
  ],
  title:
    'SpheroSeg sperm morphology models (three-part and two-part): trained weights',
  version: '1.0.0',
  year: '2026',
  doi: '10.5281/zenodo.24415067',
  bibtex: String.raw`@misc{prusek2026spermweights,
  title        = {{SpheroSeg} sperm morphology models (three-part and two-part): trained weights},
  author       = {Pr{\r{u}}{\v{s}}ek, Michal and Novoz{\'a}msk{\'y}, Adam and {\v{S}}roubek, Filip and Nesn{\'i}dalov{\'a}, So{\v{n}}a and Albrechtov{\'a}, Jana and Albrecht, Tom{\'a}{\v{s}}},
  howpublished = {Zenodo},
  version      = {1.0.0},
  year         = {2026},
  doi          = {10.5281/zenodo.24415067},
  url          = {https://doi.org/10.5281/zenodo.24415067}
}`,
  // The weights are a DINOv3 derivative under the DINOv3 License, which
  // requires publications to acknowledge DINOv3 (record README + LICENSE).
  noteKey: 'landing.citation.notes.dinov3',
};

/** Modules with a published record, in the order the page lists them. */
export const MODULE_CITATIONS: readonly ModuleCitation[] = [SPERM_MODELS];

/**
 * The BibTeX to copy: the paper first, then each selected module in
 * `modules` order — never in click order, so the same selection always
 * yields the same text. `modules` is a parameter only so that the order can
 * be tested before a second record exists.
 */
export function citationBibtex(
  selected: readonly ProjectType[],
  modules: readonly ModuleCitation[] = MODULE_CITATIONS
): string {
  return [
    SPHEROSEG_BIBTEX,
    ...modules.filter(m => selected.includes(m.projectType)).map(m => m.bibtex),
  ].join('\n\n');
}
