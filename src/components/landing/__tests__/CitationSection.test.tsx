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
  selectedModules,
  type ModuleCitation,
} from '@/lib/citation';
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

/*
 * The sperm entry exactly as first shipped and typeset (plainnat,
 * elsarticle-num, IEEEtran, biblatex: 0 warnings, 0 errors). It is now
 * GENERATED from the record's fields, and must still come out byte for byte.
 */
const SPERM_BIBTEX = String.raw`@misc{prusek2026spermweights,
  title        = {{SpheroSeg} sperm morphology models (three-part and two-part): trained weights},
  author       = {Pr{\r{u}}{\v{s}}ek, Michal and Novoz{\'a}msk{\'y}, Adam and {\v{S}}roubek, Filip and Nesn{\'i}dalov{\'a}, So{\v{n}}a and Albrechtov{\'a}, Jana and Albrecht, Tom{\'a}{\v{s}}},
  howpublished = {Zenodo},
  version      = {1.0.0},
  year         = {2026},
  doi          = {10.5281/zenodo.24415067},
  url          = {https://doi.org/10.5281/zenodo.24415067}
}`;

const spermRecord = () =>
  MODULE_CITATIONS.find(m => m.projectType === 'sperm')!;

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
    ).toEqual(MODULE_CITATIONS.map(m => `projects.types.${m.projectType}`));
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
        'Albrecht T. SpheroSeg sperm morphology models (three-part and ' +
        'two-part): trained weights. Version 1.0.0. Zenodo (2026). ' +
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
    const keys = MODULE_CITATIONS.map(m => m.bibtexKey);
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

  it('generates the sperm BibTeX byte for byte as first shipped', () => {
    expect(moduleBibtex(spermRecord())).toBe(SPERM_BIBTEX);
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
