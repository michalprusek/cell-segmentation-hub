/**
 * The two behaviours that are invisible in a screenshot and therefore have to
 * be pinned here: nothing is fetched until the pointer arrives, and the fetch
 * starts on arrival rather than when the card finally opens.
 *
 * Whether the card LOOKS right is verified in a real browser — jsdom has no
 * layout, so a passing render assertion would prove nothing about it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';

import { render } from '@/test/utils/test-utils';
import SpecimenHoverCard from '../SpecimenHoverCard';
import { resetSpecimenGeometryCache } from '@/lib/specimens/previewGeometry';
import { previewsForModel } from '@/lib/specimens/selectPreviews';

vi.mock('@/lib/logger', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('SpecimenHoverCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    resetSpecimenGeometryCache();
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ outlines: [{ d: 'M0 0L10 10' }] }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fetches nothing until the pointer arrives', () => {
    render(
      <SpecimenHoverCard kind="model" value="hrnet">
        <button type="button">HRNet</button>
      </SpecimenHoverCard>
    );

    expect(screen.getByRole('button', { name: 'HRNet' })).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('warms every tile of the option on pointer enter', async () => {
    render(
      <SpecimenHoverCard kind="model" value="hrnet">
        <button type="button">HRNet</button>
      </SpecimenHoverCard>
    );

    fireEvent.pointerEnter(screen.getByRole('button', { name: 'HRNet' }));

    // Fetched on ARRIVAL, not on open: by the time the open delay elapses the
    // outlines are already in hand, so the card opens complete.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledTimes(previewsForModel('hrnet').length)
    );
    for (const preview of previewsForModel('hrnet')) {
      expect(fetchMock).toHaveBeenCalledWith(preview.geometry);
    }
  });

  it('does not re-fetch a tile it already has', async () => {
    const { unmount } = render(
      <SpecimenHoverCard kind="model" value="hrnet">
        <button type="button">HRNet</button>
      </SpecimenHoverCard>
    );
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'HRNet' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const firstPass = fetchMock.mock.calls.length;
    unmount();

    render(
      <SpecimenHoverCard kind="model" value="hrnet">
        <button type="button">HRNet again</button>
      </SpecimenHoverCard>
    );
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'HRNet again' }));

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(firstPass);
  });

  it('leaves the trigger alone for an option with no examples', () => {
    render(
      // @ts-expect-error - deliberately an id the index has no tiles for; the
      // picker must still render its option rather than an empty card.
      <SpecimenHoverCard kind="model" value="not_a_model">
        <button type="button">Unknown</button>
      </SpecimenHoverCard>
    );

    const trigger = screen.getByRole('button', { name: 'Unknown' });
    expect(trigger).toBeInTheDocument();
    // A Radix trigger stamps its own state attribute; a bare passthrough child
    // has none.
    expect(trigger).not.toHaveAttribute('data-state');
  });
});
