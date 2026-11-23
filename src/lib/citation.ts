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

interface WorkBase {
  readonly bibtexKey: string;
  /** All of them, in order; the page shortens long lists, the BibTeX never does. */
  readonly creators: readonly Creator[];
  readonly title: string;
  readonly year: string;
}

/** A journal article. Metadata from Crossref for its DOI. */
export interface JournalArticle extends WorkBase {
  readonly kind: 'article';
  readonly journal: string;
  readonly volume: string;
  readonly articleNumber: string;
  readonly doi: string;
}

/** A conference paper; `doi` is absent until the proceedings are out. */
export interface ConferencePaper extends WorkBase {
  readonly kind: 'inproceedings';
  readonly booktitle: string;
  readonly address: string;
  readonly doi?: string;
}

/** A work a module's record asks to be cited together with it. */
export type CitedWork = JournalArticle | ConferencePaper;

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
  /**
   * Works the record asks to be cited WITH it (its README's "How to cite" or
   * training-data section) — external datasets, the module's own paper. The
   * platform paper is not listed: it is always cited.
   */
  readonly alsoCite?: readonly CitedWork[];
}

/** "Průšek M.", "Oliveira M. J." — the paper's reference style. */
export const referenceAuthor = ({ family, given }: Creator) =>
  `${family} ${given
    .split(/\s+/)
    .map(part => `${part[0]}.`)
    .join(' ')}`;

/** Vancouver's rule: up to six authors, else the first six and "et al.". */
export const REFERENCE_MAX_AUTHORS = 6;

export const referenceAuthors = (creators: readonly Creator[]) =>
  creators.length > REFERENCE_MAX_AUTHORS
    ? [
        ...creators.slice(0, REFERENCE_MAX_AUTHORS).map(referenceAuthor),
        'et al.',
      ]
    : creators.map(referenceAuthor);

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
 * Brace every word with a capital after its first letter, so a style that
 * sentence-cases titles cannot print "Spheroseg". A hyphenated compound is ONE
 * word: per part, "U-Net" would brace nothing ("U" and "Net" have no inner
 * capital) and print "u-net", and "SegFormer-B0" would print "{SegFormer}-b0".
 */
const protectCase = (title: string) =>
  title.replace(/\w+(?:-\w+)*/g, w =>
    /[A-Z]/.test(w.slice(1)) ? `{${w}}` : w
  );

/** Fields aligned on the longest name, the layout of SPHEROSEG_BIBTEX. */
function bibtexEntry(
  type: string,
  key: string,
  fields: readonly (readonly [string, string])[]
): string {
  const width = Math.max(...fields.map(([name]) => name.length));
  const body = fields
    .map(([name, value]) => `  ${name.padEnd(width)} = {${value}}`)
    .join(',\n');
  return `@${type}{${key},\n${body}\n}`;
}

const bibtexAuthors = (creators: readonly Creator[]) =>
  creators
    .map(c => `${latexEscape(c.family)}, ${latexEscape(c.given)}`)
    .join(' and ');

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
  return bibtexEntry('misc', m.bibtexKey, [
    ['title', protectCase(latexEscape(m.title))],
    ['author', bibtexAuthors(m.creators)],
    ['howpublished', 'Zenodo'],
    ['version', m.version],
    ['year', m.year],
    ['doi', m.doi],
    ['url', doiUrl(m.doi)],
  ]);
}

/** The fields every style needs: @article as SPHEROSEG_BIBTEX has it. */
export function workBibtex(w: CitedWork): string {
  const head = [
    ['title', protectCase(latexEscape(w.title))],
    ['author', bibtexAuthors(w.creators)],
  ] as const;
  const link = w.doi
    ? ([
        ['doi', w.doi],
        ['url', doiUrl(w.doi)],
      ] as const)
    : [];
  return w.kind === 'article'
    ? bibtexEntry('article', w.bibtexKey, [
        ...head,
        ['journal', latexEscape(w.journal)],
        ['volume', w.volume],
        ['pages', w.articleNumber],
        ['year', w.year],
        ...link,
      ])
    : bibtexEntry('inproceedings', w.bibtexKey, [
        ...head,
        ['booktitle', protectCase(latexEscape(w.booktitle))],
        ['address', latexEscape(w.address)],
        ['year', w.year],
        ...link,
      ]);
}

/**
 * Sperm (`sperm`, `sperm_2part`): doi:10.5281/zenodo.24415067, version 1.0.0,
 * published 2026-11-23; concept DOI 10.5281/zenodo.24415066. Metadata from
 * the record's API. The SHA-256 of both deposited files equals that of the
 * deployed `sperm_final/best_model.pth` and `weights/sperm_2part.pth`.
 */
const SPERM_MODELS: ModuleCitation = {
  projectType: 'sperm',
  bibtexKey: 'prusek2026spermseg',
  creators: [
    { family: 'Průšek', given: 'Michal' },
    { family: 'Novozámský', given: 'Adam' },
    { family: 'Šroubek', given: 'Filip' },
    { family: 'Nesnídalová', given: 'Soňa' },
    { family: 'Albrechtová', given: 'Jana' },
    { family: 'Albrecht', given: 'Tomáš' },
  ],
  // Renamed on Zenodo on 2026-11-23 (revision 8; was "SpheroSeg sperm
  // morphology models (three-part and two-part): trained weights"). Same DOI,
  // same files: a metadata edit, not a new version.
  title:
    'SpermSeg: sperm morphology module of SpheroSeg (three-part and two-part models, trained weights)',
  version: '1.0.0',
  year: '2026',
  doi: '10.5281/zenodo.24415067',
  // The weights are a DINOv3 derivative under the DINOv3 License, which
  // requires publications to acknowledge DINOv3 (record README + LICENSE).
  noteKey: 'landing.citation.notes.dinov3',
};

/*
 * The three externally published datasets inside SpheroMix, which the
 * SpheroidSeg record asks every user of its models to cite (README,
 * "Training data": all five models were trained on SpheroMix at some stage).
 * Metadata from Crossref for each DOI, read 2026-11-23.
 */
const SPHEROID_ATLAS: JournalArticle = {
  kind: 'article',
  bibtexKey: 'blondeel2025atlas',
  creators: [
    { family: 'Blondeel', given: 'Eva' },
    { family: 'Peirsman', given: 'Arne' },
    { family: 'Vermeulen', given: 'Stephanie' },
    { family: 'Piccinini', given: 'Filippo' },
    { family: 'De Vuyst', given: 'Felix' },
    { family: 'Estêvão', given: 'Diogo' },
    { family: 'Al-Jamei', given: 'Sayida' },
    { family: 'Bedeschi', given: 'Martina' },
    { family: 'Castellani', given: 'Gastone' },
    { family: 'Cruz', given: 'Tânia' },
    { family: 'Dedeyne', given: 'Sándor' },
    { family: 'Oliveira', given: 'Maria José' },
    { family: 'Kawakita', given: 'Satoru' },
    { family: 'Nguyen', given: 'Huu Tuan' },
    { family: 'Kunz-Schughart', given: 'Leoni A.' },
    { family: 'Lee', given: 'Soojung' },
    { family: 'Marino', given: 'Noemi' },
    { family: 'Steigemann', given: 'Patrick' },
    { family: 'Takayama', given: 'Shuichi' },
    { family: 'Tesei', given: 'Anna' },
    { family: 'Zablowsky', given: 'Nina' },
    { family: 'Blondeel', given: 'Phillip' },
    { family: 'De Wever', given: 'Olivier' },
  ],
  title:
    'The Spheroid Light Microscopy Image Atlas for morphometrical analysis of three-dimensional cell cultures',
  journal: 'Scientific Data',
  volume: '12',
  articleNumber: '283',
  year: '2025',
  doi: '10.1038/s41597-025-04441-x',
};

const SPHEROIDJ: JournalArticle = {
  kind: 'article',
  bibtexKey: 'lacalle2021spheroidj',
  creators: [
    { family: 'Lacalle', given: 'David' },
    { family: 'Castro-Abril', given: 'Héctor Alfonso' },
    { family: 'Randelovic', given: 'Teodora' },
    { family: 'Domínguez', given: 'César' },
    { family: 'Heras', given: 'Jónathan' },
    { family: 'Mata', given: 'Eloy' },
    { family: 'Mata', given: 'Gadea' },
    { family: 'Méndez', given: 'Yolanda' },
    { family: 'Pascual', given: 'Vico' },
    { family: 'Ochoa', given: 'Ignacio' },
  ],
  title: 'SpheroidJ: An Open-Source Set of Tools for Spheroid Segmentation',
  journal: 'Computer Methods and Programs in Biomedicine',
  volume: '200',
  articleNumber: '105837',
  year: '2021',
  doi: '10.1016/j.cmpb.2020.105837',
};

const SPHEROID_STYLE_TRANSFER: JournalArticle = {
  kind: 'article',
  bibtexKey: 'garciadominguez2024style',
  creators: [
    { family: 'García-Domínguez', given: 'Manuel' },
    { family: 'Domínguez', given: 'César' },
    { family: 'Heras', given: 'Jónathan' },
    { family: 'Mata', given: 'Eloy' },
    { family: 'Pascual', given: 'Vico' },
  ],
  title:
    'Deep style transfer to deal with the domain shift problem on spheroid segmentation',
  journal: 'Neurocomputing',
  volume: '569',
  articleNumber: '127105',
  year: '2024',
  doi: '10.1016/j.neucom.2023.127105',
};

/**
 * Spheroids (`hrnet`, `cbam_resunet`, `unet_spherohq`, `segformer`,
 * `mamba_unet`): SpheroidSeg, doi:10.5281/zenodo.24439099, version 1.0.0,
 * published 2026-11-23; concept DOI 10.5281/zenodo.24439098. Metadata from
 * the record's API. The MD5 of all six model files equals that of the
 * deployed `weights/*.pth` and `models/segformer_config.json`.
 */
const SPHEROID_MODELS: ModuleCitation = {
  projectType: 'spheroid',
  bibtexKey: 'prusek2026spheroidseg',
  creators: [
    { family: 'Průšek', given: 'Michal' },
    { family: 'Novozámský', given: 'Adam' },
    { family: 'Škubník', given: 'Jan' },
    { family: 'Svobodová Pavlíčková', given: 'Vladimíra' },
    { family: 'Rimpelová', given: 'Silvie' },
  ],
  title:
    'SpheroidSeg: tumour-spheroid segmentation module of SpheroSeg (HRNet, CBAM-ResUNet, U-Net, SegFormer-B0, Mamba-UNet; trained weights)',
  version: '1.0.0',
  year: '2026',
  doi: '10.5281/zenodo.24439099',
  alsoCite: [SPHEROID_ATLAS, SPHEROIDJ, SPHEROID_STYLE_TRANSFER],
};

/**
 * The paper the ScratchSeg record asks to be cited with it, as the record
 * gives it. No DOI yet (Crossref has no entry for the title on 2026-11-23):
 * add `doi` once the workshop proceedings are published.
 */
const WOUND_PAPER: ConferencePaper = {
  kind: 'inproceedings',
  bibtexKey: 'veskrna2026wound',
  creators: [
    { family: 'Veškrna', given: 'Lukáš' },
    { family: 'Průšek', given: 'Michal' },
    { family: 'Novozámský', given: 'Adam' },
    { family: 'Šroubek', given: 'Filip' },
    { family: 'Svobodová Pavlíčková', given: 'Vladimíra' },
    { family: 'Rimpelová', given: 'Silvie' },
  ],
  title:
    'Generalizing Wound Healing Segmentation: From Semi-Automatic Annotation to Robust Inference',
  booktitle: 'IEEE ICIP 2026 Workshop Learning Beyond Deep Learning (LBDL) II',
  address: 'Tampere',
  year: '2026',
};

/**
 * Wound healing (`wound`): ScratchSeg, doi:10.5281/zenodo.24416067, version
 * 1.0.0, published 2026-11-23; concept DOI 10.5281/zenodo.24416066. Metadata
 * from the record's API. The MD5 of `wound_mitb5.ckpt` equals that of the
 * deployed `weights/wound_mitb5.ckpt`. (The record's dataset,
 * doi:10.5281/zenodo.24416065, is deliberately not offered here.)
 */
const WOUND_MODELS: ModuleCitation = {
  projectType: 'wound',
  bibtexKey: 'veskrna2026scratchseg',
  creators: [
    { family: 'Veškrna', given: 'Lukáš' },
    { family: 'Průšek', given: 'Michal' },
    { family: 'Novozámský', given: 'Adam' },
    { family: 'Šroubek', given: 'Filip' },
    { family: 'Svobodová Pavlíčková', given: 'Vladimíra' },
    { family: 'Rimpelová', given: 'Silvie' },
  ],
  title:
    'ScratchSeg: wound-healing assay module of SpheroSeg (SpheroSeg wound model, fair-recipe benchmark of 11 models and leave-one-cell-line-out models; trained weights)',
  version: '1.0.0',
  year: '2026',
  doi: '10.5281/zenodo.24416067',
  alsoCite: [WOUND_PAPER],
};

/** Modules with a published record, in the order the page lists them. */
export const MODULE_CITATIONS: readonly ModuleCitation[] = [
  SPHEROID_MODELS,
  WOUND_MODELS,
  SPERM_MODELS,
];

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

/**
 * The BibTeX to copy: the paper first, then each given module followed by
 * the works its record asks to be cited with it. A work two modules share is
 * written once — BibTeX rejects a repeated key.
 */
export function citationBibtex(modules: readonly ModuleCitation[]): string {
  const seen = new Set<string>();
  const entries: string[] = [];
  for (const m of modules) {
    for (const [key, entry] of [
      [m.bibtexKey, () => moduleBibtex(m)] as const,
      ...(m.alsoCite ?? []).map(
        w => [w.bibtexKey, () => workBibtex(w)] as const
      ),
    ]) {
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry());
    }
  }
  return [SPHEROSEG_BIBTEX, ...entries].join('\n\n');
}
