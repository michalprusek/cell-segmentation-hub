/**
 * The welcome page's "How to cite". The reference is checked against the
 * paper's literal metadata (Crossref, doi:10.1016/j.cmpb.2026.109602), not
 * against the constants it is rendered from: a typo in `citation.ts` must fail
 * here rather than be copied into people's bibliographies.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import CitationSection from '../CitationSection';
import {
  MODULE_CITATIONS,
  SPHEROSEG_BIBTEX,
  citationBibtex,
  latexEscape,
  moduleBibtex,
  referenceAuthors,
  selectedModules,
  workBibtex,
  type CitedWork,
  type ModuleCitation,
} from '@/lib/citation';
import * as PINNED from './citationFixtures';
import { PROJECT_TYPES } from '@/types';
import en from '@/translations/en';
import cs from '@/translations/cs';
import es from '@/translations/es';
import de from '@/translations/de';
import fr from '@/translations/fr';
import zh from '@/translations/zh';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

const DOI = '10.1016/j.cmpb.2026.109602';

describe('CitationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the full reference, linked to its DOI', () => {
    render(<CitationSection />);
    const ref = screen.getByTestId('citation-reference');
    expect(ref.textContent).toBe(
      'Průšek M., Novozámský A., Škubník J., Svobodová Pavlíčková V., ' +
        'Rimpelová S. SpheroSeg: Advancing tumor spheroid analysis through ' +
        'open-source deep learning. Computer Methods and Programs in ' +
        `Biomedicine 286 (2026) 109602. doi:${DOI}`
    );
    const link = screen.getByRole('link', { name: `doi:${DOI}` });
    expect(link).toHaveAttribute('href', `https://doi.org/${DOI}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('shows the BibTeX it copies', () => {
    render(<CitationSection />);
    expect(screen.getByText(/@article\{prusek2026spheroseg,/).textContent).toBe(
      SPHEROSEG_BIBTEX
    );
  });

  it('copies exactly the BibTeX and says so', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    render(<CitationSection />);

    await user.click(
      screen.getByRole('button', { name: 'landing.citation.copyBibtex' })
    );

    expect(writeText).toHaveBeenCalledWith(SPHEROSEG_BIBTEX);
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

    await user.click(
      screen.getByRole('button', { name: 'landing.citation.copyBibtex' })
    );

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith('landing.citation.copyFailed')
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe('SPHEROSEG_BIBTEX', () => {
  const field = (name: string) =>
    SPHEROSEG_BIBTEX.match(
      new RegExp(String.raw`^\s*${name}\s*=\s*\{(.*)\},?$`, 'm')
    )?.[1];

  it('carries the paper’s identifiers', () => {
    expect(field('doi')).toBe(DOI);
    expect(field('volume')).toBe('286');
    expect(field('pages')).toBe('109602');
    expect(field('year')).toBe('2026');
    expect(field('journal')).toBe(
      'Computer Methods and Programs in Biomedicine'
    );
  });

  it('lists the five authors in order, last name first', () => {
    const authors = field('author')!.split(' and ');
    expect(authors).toEqual([
      String.raw`Pr{\r{u}}{\v{s}}ek, Michal`,
      String.raw`Novoz{\'a}msk{\'y}, Adam`,
      String.raw`{\v{S}}kubn{\'i}k, Jan`,
      String.raw`Svobodov{\'a} Pavl{\'i}{\v{c}}kov{\'a}, Vladim{\'i}ra`,
      String.raw`Rimpelov{\'a}, Silvie`,
    ]);
  });

  it('is one well-formed entry: braces balance and never go negative', () => {
    let depth = 0;
    for (const ch of SPHEROSEG_BIBTEX) {
      if (ch === '{') depth++;
      if (ch === '}') depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBe(0);
    expect(SPHEROSEG_BIBTEX.trimEnd().endsWith('}')).toBe(true);
  });
});

/*
 * Per-module citations. Checked against the Zenodo record's LITERAL metadata
 * (https://zenodo.org/api/records/24415067, read 2026-11-23), not against the
 * constants: a typo in an author's name must fail here.
 */
const SPERM_DOI = '10.5281/zenodo.24415067';
const SPERM_TOGGLE = { name: 'projects.types.sperm' };

const SPERM_BIBTEX = PINNED.BIB_PRUSEK2026SPERMSEG;

const bibtexBlock = () =>
  screen.getByText(/@article\{prusek2026spheroseg,/).textContent;

describe('CitationSection — module citations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects no module by default: paper only, toggle off', () => {
    render(<CitationSection />);
    const toggle = screen.getByRole('button', SPERM_TOGGLE);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('citation-module-sperm')).toBeNull();
    expect(bibtexBlock()).toBe(SPHEROSEG_BIBTEX);
  });

  it('names the toggle group briefly and describes it with the intro', () => {
    render(<CitationSection />);
    // Short accessible name; the three-sentence intro is the description,
    // not the name a screen reader repeats on entering the group.
    const group = screen.getByRole('group', {
      name: 'landing.citation.modulesLabel',
      description: 'landing.citation.modulesIntro',
    });
    expect(
      Array.from(group.querySelectorAll('button')).map(b => b.textContent)
    ).toEqual([
      ...MODULE_CITATIONS.map(m => `projects.types.${m.projectType}`),
      'landing.citation.otherModule',
    ]);
  });

  it('adds the record’s full reference, its DOI link and its licence note', async () => {
    const user = userEvent.setup();
    render(<CitationSection />);

    await user.click(screen.getByRole('button', SPERM_TOGGLE));

    expect(screen.getByRole('button', SPERM_TOGGLE)).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(
      screen.getByTestId('citation-module-reference-sperm').textContent
    ).toBe(
      'Průšek M., Novozámský A., Šroubek F., Nesnídalová S., Albrechtová J., ' +
        'Albrecht T. SpermSeg: sperm morphology module of SpheroSeg ' +
        '(three-part and two-part models, trained weights). Version 1.0.0. ' +
        'Zenodo (2026). ' +
        `doi:${SPERM_DOI}`
    );
    const link = screen.getByRole('link', { name: `doi:${SPERM_DOI}` });
    expect(link).toHaveAttribute('href', `https://doi.org/${SPERM_DOI}`);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByTestId('citation-module-sperm').textContent).toContain(
      'landing.citation.notes.dinov3'
    );
    // The paper is never replaced: the record asks to be cited with it.
    expect(screen.getByTestId('citation-reference')).toBeInTheDocument();
  });

  it('shows and copies the paper plus the selected module', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    render(<CitationSection />);

    await user.click(screen.getByRole('button', SPERM_TOGGLE));
    const both = `${SPHEROSEG_BIBTEX}\n\n${SPERM_BIBTEX}`;
    expect(bibtexBlock()).toBe(both);

    await user.click(
      screen.getByRole('button', { name: 'landing.citation.copyBibtex' })
    );
    expect(writeText).toHaveBeenCalledWith(both);
  });

  it('removes the module again when toggled off', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    render(<CitationSection />);
    const toggle = screen.getByRole('button', SPERM_TOGGLE);

    await user.click(toggle);
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('citation-module-sperm')).toBeNull();
    expect(bibtexBlock()).toBe(SPHEROSEG_BIBTEX);
    await user.click(
      screen.getByRole('button', { name: 'landing.citation.copyBibtex' })
    );
    expect(writeText).toHaveBeenCalledWith(SPHEROSEG_BIBTEX);
  });
});

describe('MODULE_CITATIONS', () => {
  it('has one record per module (project type), by design', () => {
    // The owner's plan is one model, hence one record, per module. A second
    // record for one type would also need a label of its own — this fails
    // so that it is a decision, not a duplicate toggle.
    const types = MODULE_CITATIONS.map(m => m.projectType);
    expect(new Set(types).size).toBe(types.length);
    for (const type of types) expect(PROJECT_TYPES).toContain(type);
    const keys = MODULE_CITATIONS.flatMap(m => [
      m.bibtexKey,
      ...(m.alsoCite ?? []).map(w => w.bibtexKey),
    ]);
    expect(new Set([...keys, 'prusek2026spheroseg']).size).toBe(
      keys.length + 1
    );
  });

  it('resolves every licence note in all six languages', () => {
    const locales = { en, cs, es, de, fr, zh };
    for (const m of MODULE_CITATIONS.filter(m => m.noteKey)) {
      for (const [lang, strings] of Object.entries(locales)) {
        const value = m
          .noteKey!.split('.')
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)?.[part],
            strings
          );
        expect(typeof value, `${m.noteKey} in ${lang}`).toBe('string');
        expect((value as string).length).toBeGreaterThan(20);
      }
    }
  });

  it('generates a well-formed entry: braces balance and never go negative', () => {
    for (const m of MODULE_CITATIONS) {
      let depth = 0;
      for (const ch of moduleBibtex(m)) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
    }
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

describe('selectedModules / citationBibtex', () => {
  const record = (
    projectType: ModuleCitation['projectType']
  ): ModuleCitation => ({
    projectType,
    bibtexKey: projectType,
    creators: [{ family: 'Doe', given: 'Jane' }],
    title: projectType,
    version: '1',
    year: '2026',
    doi: `10.0/${projectType}`,
  });
  const modules = [record('wound'), record('sperm')];

  it('is the paper alone when nothing is selected', () => {
    expect(selectedModules([], modules)).toEqual([]);
    expect(citationBibtex([])).toBe(SPHEROSEG_BIBTEX);
  });

  it('ignores a selected type that has no record', () => {
    expect(selectedModules(['microtubules'], modules)).toEqual([]);
  });

  it('orders modules by the list, never by the order they were clicked', () => {
    const keys = (sel: ModuleCitation['projectType'][]) =>
      selectedModules(sel, modules).map(m => m.bibtexKey);
    expect(keys(['sperm', 'wound'])).toEqual(['wound', 'sperm']);
    expect(keys(['wound', 'sperm'])).toEqual(['wound', 'sperm']);
  });

  it('copies the paper, then each module, separated by a blank line', () => {
    expect(citationBibtex(modules)).toBe(
      [SPHEROSEG_BIBTEX, ...modules.map(moduleBibtex)].join('\n\n')
    );
  });
});

/*
 * SpheroidSeg and ScratchSeg, and the works their records ask to be cited
 * with them. Literal metadata from the Zenodo API (24439099, 24416067) and
 * Crossref (the three dataset DOIs), read 2026-11-23.
 */
const moduleOf = (type: ModuleCitation['projectType']) =>
  MODULE_CITATIONS.find(m => m.projectType === type)!;
const work = (key: string): CitedWork =>
  MODULE_CITATIONS.flatMap(m => m.alsoCite ?? []).find(
    w => w.bibtexKey === key
  )!;

describe('Spheroid and wound-healing records', () => {
  it('lists the modules in project-type order', () => {
    expect(MODULE_CITATIONS.map(m => m.projectType)).toEqual([
      'spheroid',
      'wound',
      'sperm',
    ]);
  });

  it('cites the versioned DOIs, never the concept DOIs', () => {
    expect(moduleOf('spheroid').doi).toBe('10.5281/zenodo.24439099');
    expect(moduleOf('wound').doi).toBe('10.5281/zenodo.24416067');
    const concept = [
      '10.5281/zenodo.24439098',
      '10.5281/zenodo.24416066',
      '10.5281/zenodo.24415066',
      // The ScratchSeg DATASET is deliberately not offered.
      '10.5281/zenodo.24416065',
    ];
    for (const m of MODULE_CITATIONS) expect(concept).not.toContain(m.doi);
  });

  it('asks for exactly the works each record asks for', () => {
    expect(moduleOf('spheroid').alsoCite!.map(w => w.doi)).toEqual([
      '10.1038/s41597-025-04441-x',
      '10.1016/j.cmpb.2020.105837',
      '10.1016/j.neucom.2023.127105',
    ]);
    expect(moduleOf('wound').alsoCite!.map(w => w.bibtexKey)).toEqual([
      'veskrna2026wound',
    ]);
    expect(moduleOf('sperm').alsoCite).toBeUndefined();
    // The platform paper is always cited, so no record repeats it.
    for (const w of MODULE_CITATIONS.flatMap(m => m.alsoCite ?? []))
      expect(w.doi).not.toBe('10.1016/j.cmpb.2026.109602');
  });

  it('keeps every Crossref author, in order', () => {
    const atlas = work('blondeel2025atlas').creators;
    expect(atlas).toHaveLength(23);
    expect(atlas[0]).toEqual({ family: 'Blondeel', given: 'Eva' });
    expect(atlas[22]).toEqual({ family: 'De Wever', given: 'Olivier' });
    expect(work('lacalle2021spheroidj').creators).toHaveLength(10);
    expect(work('garciadominguez2024style').creators).toHaveLength(5);
  });

  it('generates every entry byte for byte as typeset', () => {
    const generated = [
      moduleBibtex(moduleOf('spheroid')),
      ...moduleOf('spheroid').alsoCite!.map(workBibtex),
      moduleBibtex(moduleOf('wound')),
      ...moduleOf('wound').alsoCite!.map(workBibtex),
      moduleBibtex(moduleOf('sperm')),
    ];
    expect(generated).toEqual([
      PINNED.BIB_PRUSEK2026SPHEROIDSEG,
      PINNED.BIB_BLONDEEL2025ATLAS,
      PINNED.BIB_LACALLE2021SPHEROIDJ,
      PINNED.BIB_GARCIADOMINGUEZ2024STYLE,
      PINNED.BIB_VESKRNA2026SCRATCHSEG,
      PINNED.BIB_VESKRNA2026WOUND,
      PINNED.BIB_PRUSEK2026SPERMSEG,
    ]);
  });

  it('writes the identifiers Crossref gives', () => {
    const field = (entry: string, name: string) =>
      entry.match(
        new RegExp(String.raw`^\s*${name}\s*=\s*\{(.*)\},?$`, 'm')
      )?.[1];
    const atlas = workBibtex(work('blondeel2025atlas'));
    expect([
      field(atlas, 'journal'),
      field(atlas, 'volume'),
      field(atlas, 'pages'),
      field(atlas, 'year'),
    ]).toEqual(['Scientific Data', '12', '283', '2025']);
    const spheroidj = workBibtex(work('lacalle2021spheroidj'));
    expect([
      field(spheroidj, 'journal'),
      field(spheroidj, 'volume'),
      field(spheroidj, 'pages'),
      field(spheroidj, 'year'),
    ]).toEqual([
      'Computer Methods and Programs in Biomedicine',
      '200',
      '105837',
      '2021',
    ]);
    const style = workBibtex(work('garciadominguez2024style'));
    expect([
      field(style, 'journal'),
      field(style, 'volume'),
      field(style, 'pages'),
      field(style, 'year'),
    ]).toEqual(['Neurocomputing', '569', '127105', '2024']);
  });

  it('gives the workshop paper no DOI until it has one', () => {
    const entry = workBibtex(work('veskrna2026wound'));
    expect(entry).toMatch(/^@inproceedings\{veskrna2026wound,$/m);
    expect(entry).not.toMatch(/doi|url/);
    const withDoi = workBibtex({
      ...(work('veskrna2026wound') as CitedWork),
      doi: '10.1109/x',
    });
    expect(withDoi).toContain('  doi       = {10.1109/x},');
    expect(withDoi).toContain('  url       = {https://doi.org/10.1109/x}');
  });
});

describe('title case protection', () => {
  it('braces a hyphenated model name as ONE word', () => {
    const entry = workBibtex({
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

describe('referenceAuthors', () => {
  const people = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      family: `F${i}`,
      given: 'Ann Bea',
    }));

  it('lists up to six authors in full, initials of every given name', () => {
    expect(referenceAuthors(people(6))).toEqual(
      Array.from({ length: 6 }, (_, i) => `F${i} A. B.`)
    );
  });

  it('shortens seven or more to the first six and "et al."', () => {
    expect(referenceAuthors(people(7))).toEqual([
      ...Array.from({ length: 6 }, (_, i) => `F${i} A. B.`),
      'et al.',
    ]);
  });
});

describe('citationBibtex with works', () => {
  const shared: CitedWork = {
    kind: 'article',
    bibtexKey: 'shared2026',
    creators: [{ family: 'Doe', given: 'Jane' }],
    title: 'Shared data',
    journal: 'J',
    volume: '1',
    articleNumber: '1',
    year: '2026',
    doi: '10.0/shared',
  };
  const mod = (projectType: ModuleCitation['projectType']): ModuleCitation => ({
    projectType,
    bibtexKey: `${projectType}2026`,
    creators: [{ family: 'Doe', given: 'Jane' }],
    title: projectType,
    version: '1',
    year: '2026',
    doi: `10.0/${projectType}`,
    alsoCite: [shared],
  });

  it('follows each module by its works, and writes a shared work once', () => {
    const [a, b] = [mod('wound'), mod('sperm')];
    expect(citationBibtex([a, b])).toBe(
      [
        SPHEROSEG_BIBTEX,
        moduleBibtex(a),
        workBibtex(shared),
        moduleBibtex(b),
      ].join('\n\n')
    );
  });
});

describe('CitationSection — records with works to cite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the spheroid record, then the three datasets it asks for', async () => {
    const user = userEvent.setup();
    render(<CitationSection />);
    await user.click(
      screen.getByRole('button', { name: 'projects.types.spheroid' })
    );

    expect(
      screen.getByTestId('citation-module-reference-spheroid').textContent
    ).toBe(
      'Průšek M., Novozámský A., Škubník J., Svobodová Pavlíčková V., ' +
        'Rimpelová S. SpheroidSeg: tumour-spheroid segmentation module of ' +
        'SpheroSeg (HRNet, CBAM-ResUNet, U-Net, SegFormer-B0, Mamba-UNet; ' +
        'trained weights). Version 1.0.0. Zenodo (2026). ' +
        'doi:10.5281/zenodo.24439099'
    );
    const module = screen.getByTestId('citation-module-spheroid');
    expect(module.textContent).toContain('landing.citation.alsoCite');
    expect(
      screen.getByTestId('citation-work-blondeel2025atlas').textContent
    ).toBe(
      'Blondeel E., Peirsman A., Vermeulen S., Piccinini F., De Vuyst F., ' +
        'Estêvão D., et al. The Spheroid Light Microscopy Image Atlas for ' +
        'morphometrical analysis of three-dimensional cell cultures. ' +
        'Scientific Data 12 (2025) 283. doi:10.1038/s41597-025-04441-x'
    );
    expect(
      screen.getByTestId('citation-work-garciadominguez2024style').textContent
    ).toBe(
      'García-Domínguez M., Domínguez C., Heras J., Mata E., Pascual V. ' +
        'Deep style transfer to deal with the domain shift problem on ' +
        'spheroid segmentation. Neurocomputing 569 (2024) 127105. ' +
        'doi:10.1016/j.neucom.2023.127105'
    );
    expect(
      screen.getByRole('link', { name: 'doi:10.1016/j.cmpb.2020.105837' })
    ).toHaveAttribute('href', 'https://doi.org/10.1016/j.cmpb.2020.105837');
    expect(bibtexBlock()).toBe(
      [
        SPHEROSEG_BIBTEX,
        PINNED.BIB_PRUSEK2026SPHEROIDSEG,
        PINNED.BIB_BLONDEEL2025ATLAS,
        PINNED.BIB_LACALLE2021SPHEROIDJ,
        PINNED.BIB_GARCIADOMINGUEZ2024STYLE,
      ].join('\n\n')
    );
  });

  it('shows the workshop paper without a DOI link', async () => {
    const user = userEvent.setup();
    render(<CitationSection />);
    await user.click(
      screen.getByRole('button', { name: 'projects.types.wound' })
    );

    const paper = screen.getByTestId('citation-work-veskrna2026wound');
    expect(paper.textContent).toBe(
      'Veškrna L., Průšek M., Novozámský A., Šroubek F., Svobodová ' +
        'Pavlíčková V., Rimpelová S. Generalizing Wound Healing ' +
        'Segmentation: From Semi-Automatic Annotation to Robust Inference. ' +
        'IEEE ICIP 2026 Workshop Learning Beyond Deep Learning (LBDL) II, ' +
        'Tampere (2026).'
    );
    expect(paper.querySelector('a')).toBeNull();
  });

  it('copies every selected module with its works, in page order', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    render(<CitationSection />);
    // Clicked in REVERSE page order on purpose.
    await user.click(
      screen.getByRole('button', { name: 'projects.types.sperm' })
    );
    await user.click(
      screen.getByRole('button', { name: 'projects.types.wound' })
    );
    await user.click(
      screen.getByRole('button', { name: 'landing.citation.copyBibtex' })
    );

    expect(writeText).toHaveBeenCalledWith(
      [
        SPHEROSEG_BIBTEX,
        PINNED.BIB_VESKRNA2026SCRATCHSEG,
        PINNED.BIB_VESKRNA2026WOUND,
        PINNED.BIB_PRUSEK2026SPERMSEG,
      ].join('\n\n')
    );
  });
});

describe('CitationSection — "Other module / SpheroSeg as a whole"', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const otherToggle = () =>
    screen.getByRole('button', { name: 'landing.citation.otherModule' });

  it('is off by default and explains nothing until chosen', () => {
    render(<CitationSection />);
    expect(otherToggle()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('citation-other-module')).toBeNull();
  });

  it('explains that the paper covers it, and adds nothing to the BibTeX', async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);
    render(<CitationSection />);

    await user.click(otherToggle());

    expect(otherToggle()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('citation-other-module').textContent).toBe(
      'landing.citation.otherModuleNote'
    );
    expect(screen.getByTestId('citation-reference')).toBeInTheDocument();
    expect(bibtexBlock()).toBe(SPHEROSEG_BIBTEX);
    await user.click(
      screen.getByRole('button', { name: 'landing.citation.copyBibtex' })
    );
    expect(writeText).toHaveBeenCalledWith(SPHEROSEG_BIBTEX);
  });

  it('combines with a module: the module is still cited', async () => {
    const user = userEvent.setup();
    render(<CitationSection />);
    await user.click(otherToggle());
    await user.click(screen.getByRole('button', SPERM_TOGGLE));

    expect(screen.getByTestId('citation-other-module')).toBeInTheDocument();
    expect(bibtexBlock()).toBe(`${SPHEROSEG_BIBTEX}\n\n${SPERM_BIBTEX}`);
  });

  it('hides the explanation again when toggled off', async () => {
    const user = userEvent.setup();
    render(<CitationSection />);
    await user.click(otherToggle());
    await user.click(otherToggle());

    expect(otherToggle()).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('citation-other-module')).toBeNull();
  });
});
