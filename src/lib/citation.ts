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

export const SPHEROSEG_PAPER_URL = `https://doi.org/${SPHEROSEG_PAPER.doi}`;

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
