import type { Translations } from '@/contexts/LanguageContext.types';
import type { ProjectType } from '@/types';

export const doiUrl = (doi: string) => `https://doi.org/${doi}`;

/** A licence note's translation key; a typo is a type error, not a raw key on the page. */
export type CitationNoteKey =
  `landing.citation.notes.${Extract<keyof Translations['landing']['citation']['notes'], string>}`;

export interface Creator {
  readonly family: string;
  readonly given: string;
}

interface WorkBase {
  readonly bibtexKey: string;
  /** All of them, in the order the work lists them. */
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

/** A Zenodo record, cited at its VERSIONED DOI: the exact files the app serves. */
export interface ZenodoRecord extends WorkBase {
  readonly kind: 'zenodo';
  readonly version: string;
  readonly doi: string;
}

export type Citation = JournalArticle | ConferencePaper | ZenodoRecord;

/** "Průšek M.", "Svobodová Pavlíčková V." — the paper's reference style. */
export const referenceAuthor = ({ family, given }: Creator) =>
  `${family} ${given
    .split(/\s+/)
    .map(part => `${part[0]}.`)
    .join(' ')}`;

export const referenceAuthors = (creators: readonly Creator[]) =>
  creators.map(referenceAuthor);

/*
 * Diacritics are LaTeX-escaped rather than UTF-8: classic BibTeX under
 * pdfLaTeX mangles or rejects "ů" and "š", while the escaped form works with
 * every toolchain, biber included. A letter is decomposed (NFD) into its base
 * and ONE combining mark, and the mark picks the accent command: "š" -> s +
 * caron -> {\v{s}}. Anything else non-ASCII THROWS rather than passing
 * through: a name that comes out wrong in someone's bibliography is worse
 * than a failing test when the work is added.
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

/*
 * A title for BibTeX: escaped, and every word a sentence-casing style must not
 * lower-case braced — "SpheroSeg", "IRM", "V16", "DEB_S4". Words are found in
 * the RAW text and escaped one by one: bracing after escaping split "DEB\_S4"
 * at the backslash into "{DEB}\{_S4}", which LaTeX reads as an escaped brace.
 * A hyphenated compound is ONE word: per part, "U-Net" would brace nothing and
 * print "u-net", and "SegFormer-B0" would print "{SegFormer}-b0".
 */
const TITLE_WORD = /[\p{L}\p{N}_]+(?:-[\p{L}\p{N}_]+)*/gu;

/** A capital after the first letter ("SpheroSeg"), or a capital with a digit ("V16"). */
const needsCaseProtection = (word: string) =>
  /\p{Lu}/u.test(word.slice(1)) ||
  (/^\p{Lu}/u.test(word) && /\p{N}/u.test(word));

function bibtexTitle(title: string): string {
  const text = title.normalize('NFC');
  let out = '';
  let last = 0;
  for (const m of text.matchAll(TITLE_WORD)) {
    const word = latexEscape(m[0]);
    out += latexEscape(text.slice(last, m.index));
    out += needsCaseProtection(m[0]) ? `{${word}}` : word;
    last = m.index + m[0].length;
  }
  return out + latexEscape(text.slice(last));
}

/** Fields aligned on the longest name. */
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

const doiFields = (doi: string | undefined) =>
  doi
    ? ([
        ['doi', doi],
        ['url', doiUrl(doi)],
      ] as const)
    : [];

/*
 * A Zenodo record is `@misc` with `howpublished`, NOT the `@software` +
 * `publisher` that Zenodo's own export produces. Measured 2026-11-23 by
 * typesetting both in TeX Live 2026 with plainnat, elsarticle-num, IEEEtran,
 * unsrt and biblatex (numeric, authoryear): classic BibTeX does not know
 * `@software` (a warning, then the misc fallback), and misc never prints
 * `publisher` — so Zenodo's export drops "Zenodo" in all six styles, biblatex
 * included. `@misc` + `howpublished` prints it in all six with no warning.
 * `version` is printed by biblatex only; the classic styles identify the
 * version through the versioned DOI. A `note = {Version …}` would add it there
 * but biblatex then prints it twice.
 */
export function citationBibtex(c: Citation): string {
  const head = [
    ['title', bibtexTitle(c.title)],
    ['author', bibtexAuthors(c.creators)],
  ] as const;
  switch (c.kind) {
    case 'article':
      return bibtexEntry('article', c.bibtexKey, [
        ...head,
        ['journal', latexEscape(c.journal)],
        ['volume', c.volume],
        ['pages', c.articleNumber],
        ['year', c.year],
        ...doiFields(c.doi),
      ]);
    case 'inproceedings':
      return bibtexEntry('inproceedings', c.bibtexKey, [
        ...head,
        ['booktitle', bibtexTitle(c.booktitle)],
        ['address', latexEscape(c.address)],
        ['year', c.year],
        ...doiFields(c.doi),
      ]);
    case 'zenodo':
      return bibtexEntry('misc', c.bibtexKey, [
        ...head,
        ['howpublished', 'Zenodo'],
        ['version', c.version],
        ['year', c.year],
        ...doiFields(c.doi),
      ]);
  }
}

/**
 * The SpheroSeg platform paper. Metadata from Crossref for
 * doi:10.1016/j.cmpb.2026.109602 (Computer Methods and Programs in
 * Biomedicine, vol. 286, November 2026, article 109602).
 */
export const SPHEROSEG_PAPER: JournalArticle = {
  kind: 'article',
  bibtexKey: 'prusek2026spheroseg',
  creators: [
    { family: 'Průšek', given: 'Michal' },
    { family: 'Novozámský', given: 'Adam' },
    { family: 'Škubník', given: 'Jan' },
    { family: 'Svobodová Pavlíčková', given: 'Vladimíra' },
    { family: 'Rimpelová', given: 'Silvie' },
  ],
  title:
    'SpheroSeg: Advancing tumor spheroid analysis through open-source deep learning',
  journal: 'Computer Methods and Programs in Biomedicine',
  volume: '286',
  articleNumber: '109602',
  year: '2026',
  doi: '10.1016/j.cmpb.2026.109602',
};

/**
 * The wound-healing paper, as the ScratchSeg record
 * (doi:10.5281/zenodo.24416067) gives it. No DOI yet (Crossref has no entry
 * for the title on 2026-11-23): add `doi` once the workshop proceedings are
 * published. Until it has pages, elsarticle-num warns "empty pages" for it.
 */
export const WOUND_PAPER: ConferencePaper = {
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
 * SpermSeg (`sperm`, `sperm_2part`): doi:10.5281/zenodo.24415067, version
 * 1.0.0, published 2026-11-23; concept DOI 10.5281/zenodo.24415066. Metadata
 * from the record's API (renamed there on 2026-11-23 from "SpheroSeg sperm
 * morphology models…": same DOI, same files). The MD5 of both deposited files
 * equals that of the deployed `sperm_final/best_model.pth` and
 * `weights/sperm_2part.pth`.
 */
export const SPERMSEG_RECORD: ZenodoRecord = {
  kind: 'zenodo',
  bibtexKey: 'prusek2026spermseg',
  creators: [
    { family: 'Průšek', given: 'Michal' },
    { family: 'Novozámský', given: 'Adam' },
    { family: 'Šroubek', given: 'Filip' },
    { family: 'Nesnídalová', given: 'Soňa' },
    { family: 'Albrechtová', given: 'Jana' },
    { family: 'Albrecht', given: 'Tomáš' },
  ],
  title:
    'SpermSeg: sperm morphology module of SpheroSeg (three-part and two-part models, trained weights)',
  version: '1.0.0',
  year: '2026',
  doi: '10.5281/zenodo.24415067',
};

/**
 * MicrotubuleSeg (`microtubule`): doi:10.5281/zenodo.24415383, version 1.0.0,
 * published 2026-11-23; concept DOI 10.5281/zenodo.24415382. Metadata from
 * the record's API. The MD5 of `microtubule_v16_deb_s4_ep040.pth` and
 * `params_v16.json` equals that of the deployed weights and of
 * `models/microtubule/params_v16.json` in the running ml container. MIT
 * licence: no obligation for publications, so no note.
 */
export const MICROTUBULESEG_RECORD: ZenodoRecord = {
  kind: 'zenodo',
  bibtexKey: 'prusek2026microtubuleseg',
  creators: [
    { family: 'Průšek', given: 'Michal' },
    { family: 'Novozámský', given: 'Adam' },
    { family: 'Šroubek', given: 'Filip' },
    { family: 'Dodoková', given: 'Alica' },
    { family: 'Ondrúšková', given: 'Denisa' },
    { family: 'Podhájecký', given: 'Roman' },
    { family: 'Karhanová', given: 'Adéla' },
    { family: 'Siahaan', given: 'Valerie' },
    { family: 'Hogner', given: 'Marika' },
  ],
  title:
    'MicrotubuleSeg: IRM microtubule detection module of SpheroSeg (nnU-Net ResEnc-M V16 DEB_S4 ep040, trained on synthetic data; trained weights)',
  version: '1.0.0',
  year: '2026',
  doi: '10.5281/zenodo.24415383',
};

export const SPHEROSEG_BIBTEX = citationBibtex(SPHEROSEG_PAPER);

export type CitationChoiceId =
  'spheroid' | 'wound' | 'sperm' | 'microtubules' | 'other';

/** One choice on the page, and the ONE work it cites — nothing more. */
export interface CitationChoice {
  readonly id: CitationChoiceId;
  readonly labelKey:
    `projects.types.${ProjectType}` | 'landing.citation.otherModule';
  readonly citation: Citation;
  /** An obligation the cited work's licence attaches to publications. */
  readonly noteKey?: CitationNoteKey;
}

/**
 * The owner's mapping (2026-11-23): exactly one work per choice, and the
 * reader picks exactly one choice. A module with no work of its own is cited
 * through "Other module / SpheroSeg as a whole", i.e. the platform paper.
 */
export const CITATION_CHOICES: readonly CitationChoice[] = [
  {
    id: 'spheroid',
    labelKey: 'projects.types.spheroid',
    citation: SPHEROSEG_PAPER,
  },
  { id: 'wound', labelKey: 'projects.types.wound', citation: WOUND_PAPER },
  {
    id: 'sperm',
    labelKey: 'projects.types.sperm',
    citation: SPERMSEG_RECORD,
    // The weights are a DINOv3 derivative under the DINOv3 License, which
    // requires publications to acknowledge DINOv3 (record README + LICENSE).
    noteKey: 'landing.citation.notes.dinov3',
  },
  {
    id: 'microtubules',
    labelKey: 'projects.types.microtubules',
    citation: MICROTUBULESEG_RECORD,
  },
  {
    id: 'other',
    labelKey: 'landing.citation.otherModule',
    citation: SPHEROSEG_PAPER,
  },
];
