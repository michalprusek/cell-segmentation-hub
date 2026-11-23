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
  type ModuleCitation,
} from '@/lib/citation';
import { PROJECT_TYPES } from '@/types';

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

  it('labels the toggles with the project-type names, in their own group', () => {
    render(<CitationSection />);
    const group = screen.getByRole('group');
    expect(group).toHaveAttribute('aria-labelledby', 'citation-modules-intro');
    expect(document.getElementById('citation-modules-intro')?.textContent).toBe(
      'landing.citation.modulesIntro'
    );
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
    const both = `${SPHEROSEG_BIBTEX}\n\n${spermRecord().bibtex}`;
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
  it('has one record per known project type at most', () => {
    const types = MODULE_CITATIONS.map(m => m.projectType);
    expect(new Set(types).size).toBe(types.length);
    for (const type of types) expect(PROJECT_TYPES).toContain(type);
  });

  describe('sperm BibTeX', () => {
    const field = (name: string) =>
      spermRecord().bibtex.match(
        new RegExp(String.raw`^\s*${name}\s*=\s*\{(.*)\},?$`, 'm')
      )?.[1];

    it('is a @misc published by Zenodo, at the versioned DOI', () => {
      // @misc + howpublished: the only form that keeps "Zenodo" in plainnat,
      // elsarticle-num, IEEEtran, unsrt and biblatex alike (citation.ts).
      expect(spermRecord().bibtex).toMatch(/^@misc\{prusek2026spermweights,$/m);
      expect(field('howpublished')).toBe('Zenodo');
      expect(field('publisher')).toBeUndefined();
      expect(field('doi')).toBe(SPERM_DOI);
      expect(field('url')).toBe(`https://doi.org/${SPERM_DOI}`);
      expect(field('version')).toBe('1.0.0');
      expect(field('year')).toBe('2026');
      expect(field('title')).toBe(
        '{SpheroSeg} sperm morphology models (three-part and two-part): trained weights'
      );
    });

    it('lists the six creators in the record’s order, last name first', () => {
      expect(field('author')!.split(' and ')).toEqual([
        String.raw`Pr{\r{u}}{\v{s}}ek, Michal`,
        String.raw`Novoz{\'a}msk{\'y}, Adam`,
        String.raw`{\v{S}}roubek, Filip`,
        String.raw`Nesn{\'i}dalov{\'a}, So{\v{n}}a`,
        String.raw`Albrechtov{\'a}, Jana`,
        String.raw`Albrecht, Tom{\'a}{\v{s}}`,
      ]);
    });

    it('is one well-formed entry: braces balance and never go negative', () => {
      let depth = 0;
      for (const ch of spermRecord().bibtex) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
        expect(depth).toBeGreaterThanOrEqual(0);
      }
      expect(depth).toBe(0);
    });
  });
});

describe('citationBibtex', () => {
  const record = (projectType: ModuleCitation['projectType']) =>
    ({
      projectType,
      authors: [],
      title: projectType,
      version: '1',
      year: '2026',
      doi: `10.0/${projectType}`,
      bibtex: `@misc{${projectType}}`,
    }) satisfies ModuleCitation;
  const modules = [record('wound'), record('sperm')];

  it('is the paper alone when nothing is selected', () => {
    expect(citationBibtex([], modules)).toBe(SPHEROSEG_BIBTEX);
  });

  it('ignores a selected type that has no record', () => {
    expect(citationBibtex(['microtubules'], modules)).toBe(SPHEROSEG_BIBTEX);
  });

  it('orders modules by the list, never by the order they were clicked', () => {
    const expected = `${SPHEROSEG_BIBTEX}\n\n@misc{wound}\n\n@misc{sperm}`;
    expect(citationBibtex(['sperm', 'wound'], modules)).toBe(expected);
    expect(citationBibtex(['wound', 'sperm'], modules)).toBe(expected);
  });
});
