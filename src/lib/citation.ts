import type { Translations } from '@/contexts/LanguageContext.types';
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

/** A licence note's translation key; a typo is a type error, not a raw key on the page. */
export type CitationNoteKey =
  `landing.citation.notes.${Extract<keyof Translations['landing']['citation']['notes'], string>}`;

export interface Creator {
  readonly family: string;
  readonly given: string;
}

/**
 * A module's trained models, deposited as their own Zenodo record. Its
 * creators include the people who provided and annotated the training data,
 * so citing the module credits them; the record asks to be cited together
 * with the platform paper, which is why the paper is never replaced.
 *
 * Every field is stated ONCE: the on-page reference and the BibTeX entry are
 * both derived from it (`referenceAuthors`, `moduleBibtex`), so a new version
 * of the weights is one edit and the two cannot disagree.
 */
export interface ModuleCitation {
  /**
   * The module, i.e. the project type whose models the record holds; the
   * toggle is labelled `projects.types.<projectType>`. One record per module
   * is the owner's plan (one model per module) and a test enforces it.
   */
  readonly projectType: ProjectType;
  readonly bibtexKey: string;
  /** In the record's order, which is the citation's order. */
  readonly creators: readonly Creator[];
  readonly title: string;
  readonly version: string;
  readonly year: string;
  /**
   * The VERSIONED DOI, not the concept DOI: it names the exact files the
   * application serves. When the deployed weights change, a new Zenodo
   * version is made and this changes with it.
   */
  readonly doi: string;
  /** An obligation the record's licence attaches to publications. */
  readonly noteKey?: CitationNoteKey;
}

/** "Průšek M.", "Svobodová Pavlíčková V." — the paper's reference style. */
export const referenceAuthor = ({ family, given }: Creator) =>
  `${family} ${given
    .split(/\s+/)
    .map(part => `${part[0]}.`)
    .join(' ')}`;

export const referenceAuthors = (m: ModuleCitation) =>
  m.creators.map(referenceAuthor);

/*
 * Diacritics are LaTeX-escaped for the reason given at SPHEROSEG_BIBTEX
 * (classic BibTeX under pdfLaTeX). A letter is decomposed (NFD) into its base
 * and ONE combining mark, and the mark picks the accent command: "š" -> s +
 * caron -> {\v{s}}. Anything else non-ASCII THROWS rather than passing
 * through: a name that comes out wrong in someone's bibliography is worse
 * than a failing test when the record is added.
 */
const ACCENT_COMMANDS: Readonly<Record<string, string>> = {
  '\u0301': "'", // acute: {\'a}
  '\u0300': '`', // grave
  '\u0302': '^', // circumflex
  '\u0308': '"', // diaeresis
  '\u0303': '~', // tilde
  '\u030C': 'v', // caron: {\v{s}}
  '\u030A': 'r', // ring above: {\r{u}}
  '\u0327': 'c', // cedilla
};
const LATEX_SPECIALS = '&%$#_';

function latexChar(ch: string, text: string): string {
  if (LATEX_SPECIALS.includes(ch)) return `\\${ch}`;
  if (ch === '\u00DF') return String.raw`{\ss}`;
  if (ch <= '~' && !/[{}\\~^]/.test(ch)) return ch;
  const [base, mark, ...rest] = [...ch.normalize('NFD')];
  const command = mark === undefined ? undefined : ACCENT_COMMANDS[mark];
  if (command === undefined || rest.length > 0 || !/^[A-Za-z]$/.test(base)) {
    throw new Error(`No LaTeX escape for "${ch}" in "${text}"`);
  }
  // Symbol commands take the letter bare (\'a), letter commands braced (\v{s}).
  return /[a-z]/.test(command)
    ? `{\\${command}{${base}}}`
    : `{\\${command}${base}}`;
}

export function latexEscape(text: string): string {
  return [...text.normalize('NFC')].map(ch => latexChar(ch, text)).join('');
}

/**
 * Brace every word with a capital after its first letter ("SpheroSeg",
 * "DINOv3"), so a style that lower-cases titles cannot print "Spheroseg".
 */
const protectCase = (title: string) =>
  title.replace(/\b\w+\b/g, w => (/[A-Z]/.test(w.slice(1)) ? `{${w}}` : w));

const bibtexField = (name: string, value: string) =>
  `  ${name.padEnd(12)} = {${value}}`;

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
export function moduleBibtex(m: ModuleCitation): string {
  const author = m.creators
    .map(c => `${latexEscape(c.family)}, ${latexEscape(c.given)}`)
    .join(' and ');
  const fields = [
    bibtexField('title', protectCase(latexEscape(m.title))),
    bibtexField('author', author),
    bibtexField('howpublished', 'Zenodo'),
    bibtexField('version', m.version),
    bibtexField('year', m.year),
    bibtexField('doi', m.doi),
    bibtexField('url', doiUrl(m.doi)),
  ];
  return `@misc{${m.bibtexKey},\n${fields.join(',\n')}\n}`;
}

/**
 * Sperm (`sperm`, `sperm_2part`): doi:10.5281/zenodo.24415067, version 1.0.0,
 * published 2026-11-23; concept DOI 10.5281/zenodo.24415066. Metadata from
 * the record's API. The SHA-256 of both deposited files equals that of the
 * deployed `sperm_final/best_model.pth` and `weights/sperm_2part.pth`.
 */
const SPERM_MODELS: ModuleCitation = {
  projectType: 'sperm',
  bibtexKey: 'prusek2026spermweights',
  creators: [
    { family: 'Průšek', given: 'Michal' },
    { family: 'Novozámský', given: 'Adam' },
    { family: 'Šroubek', given: 'Filip' },
    { family: 'Nesnídalová', given: 'Soňa' },
    { family: 'Albrechtová', given: 'Jana' },
    { family: 'Albrecht', given: 'Tomáš' },
  ],
  title:
    'SpheroSeg sperm morphology models (three-part and two-part): trained weights',
  version: '1.0.0',
  year: '2026',
  doi: '10.5281/zenodo.24415067',
  // The weights are a DINOv3 derivative under the DINOv3 License, which
  // requires publications to acknowledge DINOv3 (record README + LICENSE).
  noteKey: 'landing.citation.notes.dinov3',
};

/** Modules with a published record, in the order the page lists them. */
export const MODULE_CITATIONS: readonly ModuleCitation[] = [SPERM_MODELS];

/**
 * The selected modules in `modules` order — never in click order, so the same
 * selection always yields the same references and the same BibTeX. The page
 * renders and copies THIS list, so what is shown is what is copied.
 */
export function selectedModules(
  selected: readonly ProjectType[],
  modules: readonly ModuleCitation[] = MODULE_CITATIONS
): ModuleCitation[] {
  return modules.filter(m => selected.includes(m.projectType));
}

/** The BibTeX to copy: the paper first, then each given module. */
export function citationBibtex(modules: readonly ModuleCitation[]): string {
  return [SPHEROSEG_BIBTEX, ...modules.map(moduleBibtex)].join('\n\n');
}
