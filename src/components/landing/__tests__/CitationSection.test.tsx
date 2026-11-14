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
import { SPHEROSEG_BIBTEX } from '@/lib/citation';

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
