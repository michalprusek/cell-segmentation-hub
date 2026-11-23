/**
 * The welcome page's "How to cite": the reader picks ONE module and gets the
 * ONE work that cites it. References are checked against the works' literal
 * metadata (Crossref for doi:10.1016/j.cmpb.2026.109602, the Zenodo API for
 * doi:10.5281/zenodo.24415067, the ScratchSeg record for the workshop paper),
 * not against the constants they are rendered from: a typo in `citation.ts`
 * must fail here rather than be copied into people's bibliographies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import CitationSection from '../CitationSection';
import {
  CITATION_CHOICES,
  SPHEROSEG_BIBTEX,
  WOUND_PAPER,
  citationBibtex,
  latexEscape,
  referenceAuthors,
  type ConferencePaper,
} from '@/lib/citation';
import en from '@/translations/en';
import cs from '@/translations/cs';
import es from '@/translations/es';
import de from '@/translations/de';
import fr from '@/translations/fr';
import zh from '@/translations/zh';
import * as PINNED from './citationFixtures';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const CMPB_DOI = '10.1016/j.cmpb.2026.109602';
const SPERM_DOI = '10.5281/zenodo.24415067';
const MT_DOI = '10.5281/zenodo.24415383';

const CMPB_REFERENCE =
  'Průšek M., Novozámský A., Škubník J., Svobodová Pavlíčková V., ' +
  'Rimpelová S. SpheroSeg: Advancing tumor spheroid analysis through ' +
  'open-source deep learning. Computer Methods and Programs in ' +
  `Biomedicine 286 (2026) 109602. doi:${CMPB_DOI}`;

const choose = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getByRole('radio', { name }));

const radio = (name: string) => screen.getByRole('radio', { name });

const bibtexBlock = () => screen.getByText(/^@\w+\{/).textContent;

describe('CitationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('offers one choice per module, none chosen, and cites nothing yet', () => {
    render(<CitationSection />);
    const group = screen.getByRole('radiogroup', {
      name: 'landing.citation.modulesLabel',
      description: 'landing.citation.intro',
    });
    const radios = screen.getAllByRole('radio');
    expect(radios.map(r => r.textContent)).toEqual([
      'projects.types.spheroid',
      'projects.types.wound',
      'projects.types.sperm',
      'projects.types.microtubules',
      'landing.citation.otherModule',
    ]);
    for (const r of radios) {
      expect(group).toContainElement(r);
      expect(r).toHaveAttribute('aria-checked', 'false');
    }
    expect(screen.queryByTestId('citation-reference')).toBeNull();
    expect(screen.queryByText(/^@\w+\{/)).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'landing.citation.copyBibtex' })
    ).toBeNull();
  });

  it.each(['projects.types.spheroid', 'landing.citation.otherModule'])(
    '%s cites the CMPB paper and nothing else',
    async name => {
      const user = userEvent.setup();
      render(<CitationSection />);
      await choose(user, name);

      expect(radio(name)).toHaveAttribute('aria-checked', 'true');
      expect(screen.getByTestId('citation-reference').textContent).toBe(
        CMPB_REFERENCE
      );
      const link = screen.getByRole('link', { name: `doi:${CMPB_DOI}` });
      expect(link).toHaveAttribute('href', `https://doi.org/${CMPB_DOI}`);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      expect(screen.queryByTestId('citation-note')).toBeNull();
      expect(bibtexBlock()).toBe(PINNED.BIB_PRUSEK2026SPHEROSEG);
    }
  );

  it('wound healing cites the workshop paper only, with no DOI yet', async () => {
    const user = userEvent.setup();
    render(<CitationSection />);
    await choose(user, 'projects.types.wound');

    const reference = screen.getByTestId('citation-reference');
    expect(reference.textContent).toBe(
      'Veškrna L., Průšek M., Novozámský A., Šroubek F., Svobodová ' +
        'Pavlíčková V., Rimpelová S. Generalizing Wound Healing ' +
        'Segmentation: From Semi-Automatic Annotation to Robust Inference. ' +
        'IEEE ICIP 2026 Workshop Learning Beyond Deep Learning (LBDL) II, ' +
        'Tampere (2026).'
    );
    expect(reference.querySelector('a')).toBeNull();
    expect(screen.queryByTestId('citation-note')).toBeNull();
    expect(bibtexBlock()).toBe(PINNED.BIB_VESKRNA2026WOUND);
  });

  it('sperm cites the SpermSeg record only, with the DINOv3 note', async () => {
    const user = userEvent.setup();
    render(<CitationSection />);
    await choose(user, 'projects.types.sperm');

    expect(screen.getByTestId('citation-reference').textContent).toBe(
      'Průšek M., Novozámský A., Šroubek F., Nesnídalová S., Albrechtová J., ' +
        'Albrecht T. SpermSeg: sperm morphology module of SpheroSeg ' +
        '(three-part and two-part models, trained weights). Version 1.0.0. ' +
        `Zenodo (2026). doi:${SPERM_DOI}`
    );
    expect(
      screen.getByRole('link', { name: `doi:${SPERM_DOI}` })
    ).toHaveAttribute('href', `https://doi.org/${SPERM_DOI}`);
    expect(screen.getByTestId('citation-note').textContent).toBe(
      'landing.citation.notes.dinov3'
    );
    expect(bibtexBlock()).toBe(PINNED.BIB_PRUSEK2026SPERMSEG);
  });

  it('microtubules cite the MicrotubuleSeg record only, with no note', async () => {
    const user = userEvent.setup();
    render(<CitationSection />);
    await choose(user, 'projects.types.microtubules');

    expect(screen.getByTestId('citation-reference').textContent).toBe(
      'Průšek M., Novozámský A., Šroubek F., Dodoková A., Ondrúšková D., ' +
        'Podhájecký R., Karhanová A., Siahaan V., Hogner M. MicrotubuleSeg: ' +
        'IRM microtubule detection module of SpheroSeg (nnU-Net ResEnc-M V16 ' +
        'DEB_S4 ep040, trained on synthetic data; trained weights). Version ' +
        `1.0.0. Zenodo (2026). doi:${MT_DOI}`
    );
    expect(screen.getByRole('link', { name: `doi:${MT_DOI}` })).toHaveAttribute(
      'href',
      `https://doi.org/${MT_DOI}`
    );
    expect(screen.queryByTestId('citation-note')).toBeNull();
    expect(bibtexBlock()).toBe(PINNED.BIB_PRUSEK2026MICROTUBULESEG);
  });

  it('holds one choice at a time: a second choice replaces the first', async () => {
    const user = userEvent.setup();
    render(<CitationSection />);
    await choose(user, 'projects.types.sperm');
    await choose(user, 'projects.types.wound');

    expect(radio('projects.types.sperm')).toHaveAttribute(
      'aria-checked',
      'false'
    );
    expect(radio('projects.types.wound')).toHaveAttribute(
      'aria-checked',
      'true'
    );
    expect(screen.getAllByTestId('citation-reference')).toHaveLength(1);
    expect(screen.queryByTestId('citation-note')).toBeNull();
    expect(bibtexBlock()).toBe(PINNED.BIB_VESKRNA2026WOUND);
  });

  it('copies exactly the BibTeX it shows and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    render(<CitationSection />);
    await choose(user, 'projects.types.sperm');

    await user.click(
      screen.getByRole('button', { name: 'landing.citation.copyBibtex' })
    );

    expect(writeText).toHaveBeenCalledWith(PINNED.BIB_PRUSEK2026SPERMSEG);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith('landing.citation.copied')
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('reports a refused clipboard instead of claiming success', async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
      new Error('denied')
    );
    render(<CitationSection />);
    await choose(user, 'landing.citation.otherModule');

    await user.click(
      screen.getByRole('button', { name: 'landing.citation.copyBibtex' })
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('landing.citation.copyFailed')
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('CITATION_CHOICES', () => {
  it('maps each choice to exactly the work the owner named', () => {
    expect(CITATION_CHOICES.map(c => [c.id, c.citation.bibtexKey])).toEqual([
      ['spheroid', 'prusek2026spheroseg'],
      ['wound', 'veskrna2026wound'],
      ['sperm', 'prusek2026spermseg'],
      ['microtubules', 'prusek2026microtubuleseg'],
      ['other', 'prusek2026spheroseg'],
    ]);
  });

  it('cites the versioned module DOIs and no other Zenodo record', () => {
    const dois = CITATION_CHOICES.map(c => c.citation.doi);
    expect(dois).toContain(SPERM_DOI);
    expect(dois).toContain(MT_DOI);
    for (const notCited of [
      '10.5281/zenodo.24415066', // SpermSeg concept DOI
      '10.5281/zenodo.24415382', // MicrotubuleSeg concept DOI
      '10.5281/zenodo.24439099', // SpheroidSeg
      '10.5281/zenodo.24416067', // ScratchSeg weights
      '10.5281/zenodo.24416065', // ScratchSeg dataset
    ])
      expect(dois).not.toContain(notCited);
  });

  it('resolves every label and note in all six languages', () => {
    const locales = { en, cs, es, de, fr, zh };
    const keys = CITATION_CHOICES.flatMap(c =>
      c.noteKey ? [c.labelKey, c.noteKey] : [c.labelKey]
    );
    for (const key of keys) {
      for (const [lang, strings] of Object.entries(locales)) {
        const value = key
          .split('.')
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)?.[part],
            strings
          );
        expect(typeof value, `${key} in ${lang}`).toBe('string');
        expect((value as string).trim()).not.toBe('');
      }
    }
  });
});

describe('SPHEROSEG_BIBTEX', () => {
  const field = (name: string) =>
    SPHEROSEG_BIBTEX.match(
      new RegExp(String.raw`^\s*${name}\s*=\s*\{(.*)\},?$`, 'm')
    )?.[1];

  it('is generated byte for byte as the hand-written entry it replaced', () => {
    expect(SPHEROSEG_BIBTEX).toBe(PINNED.BIB_PRUSEK2026SPHEROSEG);
  });

  it('carries the paper’s identifiers', () => {
    expect(field('doi')).toBe(CMPB_DOI);
    expect(field('volume')).toBe('286');
    expect(field('pages')).toBe('109602');
    expect(field('year')).toBe('2026');
    expect(field('journal')).toBe(
      'Computer Methods and Programs in Biomedicine'
    );
  });

  it('lists the five authors in order, last name first', () => {
    expect(field('author')!.split(' and ')).toEqual([
      String.raw`Pr{\r{u}}{\v{s}}ek, Michal`,
      String.raw`Novoz{\'a}msk{\'y}, Adam`,
      String.raw`{\v{S}}kubn{\'i}k, Jan`,
      String.raw`Svobodov{\'a} Pavl{\'i}{\v{c}}kov{\'a}, Vladim{\'i}ra`,
      String.raw`Rimpelov{\'a}, Silvie`,
    ]);
  });
});

describe('citationBibtex', () => {
  it('generates every entry the page offers byte for byte as typeset', () => {
    expect(CITATION_CHOICES.map(c => citationBibtex(c.citation))).toEqual([
      PINNED.BIB_PRUSEK2026SPHEROSEG,
      PINNED.BIB_VESKRNA2026WOUND,
      PINNED.BIB_PRUSEK2026SPERMSEG,
      PINNED.BIB_PRUSEK2026MICROTUBULESEG,
      PINNED.BIB_PRUSEK2026SPHEROSEG,
    ]);
  });

  it('gives the workshop paper a DOI only once it has one', () => {
    expect(citationBibtex(WOUND_PAPER)).not.toMatch(/doi|url/);
    const published: ConferencePaper = { ...WOUND_PAPER, doi: '10.1109/x' };
    const entry = citationBibtex(published);
    expect(entry).toContain('  doi       = {10.1109/x},');
    expect(entry).toContain('  url       = {https://doi.org/10.1109/x}');
  });

  it('braces a hyphenated model name as ONE word', () => {
    const entry = citationBibtex({
      kind: 'article',
      bibtexKey: 'k',
      creators: [{ family: 'Doe', given: 'Jane' }],
      title: 'U-Net and SegFormer-B0 beat three-part models on DINOv3',
      journal: 'J',
      volume: '1',
      articleNumber: '1',
      year: '2026',
      doi: '10.0/k',
    });
    expect(entry).toContain(
      'title   = {{U-Net} and {SegFormer-B0} beat three-part models on {DINOv3}},'
    );
  });
});

describe('bibtexTitle (through citationBibtex)', () => {
  it('braces version and run tags, and escapes an underscore INSIDE the brace', () => {
    const entry = citationBibtex({
      kind: 'zenodo',
      bibtexKey: 'k',
      creators: [{ family: 'Doe', given: 'Jane' }],
      title: 'Model V16 DEB_S4 ep040 on 3D data',
      version: '1',
      year: '2026',
      doi: '10.0/k',
    });
    // Bracing AFTER escaping split "DEB\_S4" at the backslash into
    // "{DEB}\{_S4}", which LaTeX reads as an escaped brace.
    expect(entry).toContain(
      String.raw`title        = {Model {V16} {DEB\_S4} ep040 on {3D} data},`
    );
  });
});

describe('referenceAuthors', () => {
  it('writes the family name and the initial of every given name', () => {
    expect(
      referenceAuthors([
        { family: 'Svobodová Pavlíčková', given: 'Vladimíra' },
        { family: 'Oliveira', given: 'Maria José' },
      ])
    ).toEqual(['Svobodová Pavlíčková V.', 'Oliveira M. J.']);
  });
});

describe('latexEscape', () => {
  it('escapes Czech and other single-accent letters in the paper’s style', () => {
    expect(latexEscape('Průšek')).toBe(String.raw`Pr{\r{u}}{\v{s}}ek`);
    expect(latexEscape('Šroubek Soňa')).toBe(
      String.raw`{\v{S}}roubek So{\v{n}}a`
    );
    expect(latexEscape('Nesnídalová Tomáš Ýř')).toBe(
      String.raw`Nesn{\'i}dalov{\'a} Tom{\'a}{\v{s}} {\'Y}{\v{r}}`
    );
    expect(latexEscape('Müller Ñandú Façade Straße')).toBe(
      String.raw`M{\"u}ller {\~N}and{\'u} Fa{\c{c}}ade Stra{\ss}e`
    );
  });

  it('escapes the characters LaTeX treats as commands', () => {
    expect(latexEscape('A & B: 5% of $x #1 a_b')).toBe(
      String.raw`A \& B: 5\% of \$x \#1 a\_b`
    );
  });

  it('accepts a decomposed (NFD) name like its composed form', () => {
    // "S" + U+030C COMBINING CARON, as some PDF and macOS copies deliver it.
    const decomposed = 'S\u030Croubek';
    expect(decomposed).toHaveLength(8);
    expect(latexEscape(decomposed)).toBe(String.raw`{\v{S}}roubek`);
  });

  it('refuses what it cannot escape instead of passing it through', () => {
    for (const bad of ['Łukasz', 'Søren', '王', 'a{b}', 'x~y', 'a\\b', 'ǘ'])
      expect(() => latexEscape(bad), bad).toThrow(/No LaTeX escape/);
  });
});
