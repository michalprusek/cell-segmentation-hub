/**
 * The two behaviours that are invisible in a screenshot and therefore have to
 * be pinned here: nothing is fetched until the pointer arrives, and the fetch
 * starts on arrival rather than when the card finally opens.
 *
 * Whether the card LOOKS right is verified in a real browser — jsdom has no
 * layout, so a passing render assertion would prove nothing about it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';

import { render } from '@/test/utils/test-utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

  describe('inside a menu, where an item focuses itself on pointer move', () => {
    // jsdom has no PointerEvent, and without `pointerType: 'mouse'` a Radix
    // menu item never focuses itself on hover — which is half of what this
    // block is about. A MouseEvent that carries the field is all Radix reads.
    class TestPointerEvent extends MouseEvent {
      readonly pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerType = init.pointerType ?? 'mouse';
      }
    }
    const BY_MODEL =
      'Real frames this model segmented, with the outlines it produced.';

    beforeEach(() => {
      vi.stubGlobal('PointerEvent', TestPointerEvent);
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Same shape as ProjectModelSelector: the hover card's trigger IS the
     *  radio item. */
    const renderMenu = () =>
      render(
        <DropdownMenu open modal={false}>
          <DropdownMenuTrigger>models</DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup value="hrnet">
              {(['hrnet', 'cbam_resunet', 'unet_spherohq'] as const).map(id => (
                <SpecimenHoverCard key={id} kind="model" value={id}>
                  <DropdownMenuRadioItem value={id} data-testid={id}>
                    {id}
                  </DropdownMenuRadioItem>
                </SpecimenHoverCard>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      );

    /** The card headings currently on screen — the one paragraph every open
     *  card has and no trigger does. */
    const openCards = () =>
      screen
        .queryAllByText(BY_MODEL)
        .map(
          detail =>
            detail.parentElement?.querySelector('p')?.textContent ?? '<none>'
        );

    const enter = (el: HTMLElement) => {
      fireEvent.pointerEnter(el, { pointerType: 'mouse' });
      fireEvent.pointerMove(el, { pointerType: 'mouse' });
    };
    const leave = (el: HTMLElement) =>
      fireEvent.pointerLeave(el, { pointerType: 'mouse' });
    const wait = (ms: number) =>
      act(() => {
        vi.advanceTimersByTime(ms);
      });

    it('the item takes focus on hover, so both of Radix open paths fire', () => {
      renderMenu();
      const hrnet = screen.getByTestId('hrnet');

      enter(hrnet);

      // If this ever stops holding, the regression below no longer
      // reproduces the real menu and proves nothing.
      expect(document.activeElement).toBe(hrnet);
    });

    it('an option crossed faster than the open delay leaves no card behind', () => {
      renderMenu();
      const hrnet = screen.getByTestId('hrnet');
      const cbam = screen.getByTestId('cbam_resunet');
      const unet = screen.getByTestId('unet_spherohq');

      // Down the list at reading speed: 100 ms on each of the first two rows,
      // well under the 320 ms open delay, then rest on the third.
      enter(hrnet);
      wait(100);
      leave(hrnet);
      enter(cbam);
      wait(100);
      leave(cbam);
      enter(unet);
      wait(1000);

      expect(openCards()).toEqual(['UNet (SpheroHQ)']);

      // And off the menu altogether: nothing may be left open.
      leave(unet);
      wait(1000);
      expect(openCards()).toEqual([]);
    });

    it('still opens for the option the pointer rests on', () => {
      renderMenu();
      enter(screen.getByTestId('cbam_resunet'));

      wait(200);
      expect(openCards()).toEqual([]);
      wait(200);
      expect(openCards()).toEqual(['CBAM-ResUNet']);
    });

    it('opens on the pointer alone for a trigger that never takes focus', () => {
      render(
        <SpecimenHoverCard kind="model" value="cbam_resunet">
          <span data-testid="plain">CBAM</span>
        </SpecimenHoverCard>
      );
      const plain = screen.getByTestId('plain');

      enter(plain);
      expect(document.activeElement).not.toBe(plain);

      wait(400);
      expect(openCards()).toEqual(['CBAM-ResUNet']);
    });

    it('still opens on keyboard focus with no pointer at all', () => {
      renderMenu();
      act(() => screen.getByTestId('cbam_resunet').focus());

      wait(400);
      expect(openCards()).toEqual(['CBAM-ResUNet']);
    });
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
