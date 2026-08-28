/**
 * Hero + specimen showcase.
 *
 * The showcase is the landing page's one interactive element, so what is
 * pinned here is behaviour: the tray offers every specimen, picking one swaps
 * the frame, its alt text and its outlines, and the outlines really are the
 * stored vector geometry rather than something baked into the raster.
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import Hero from '@/components/Hero';
import { SPECIMENS } from '@/components/landing/specimens';
import en from '@/translations/en';

describe('Hero', () => {
  it('renders the headline, standfirst and both calls to action', async () => {
    render(<Hero />);

    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: en.landing.hero.title,
      })
    ).toBeInTheDocument();
    expect(screen.getByText(en.landing.hero.subtitle)).toBeInTheDocument();
    expect(screen.getByText(en.landing.hero.eyebrow)).toBeInTheDocument();

    expect(
      screen.getByRole('link', { name: new RegExp(en.landing.hero.getStarted) })
    ).toHaveAttribute('href', '/sign-in');
    expect(
      screen.getByRole('link', { name: en.landing.hero.learnMore })
    ).toHaveAttribute('href', '#features');
  });

  it('offers every specimen in the tray, labelled and attributed to its model', async () => {
    render(<Hero />);

    const tabs = await screen.findAllByRole('tab');
    expect(tabs).toHaveLength(SPECIMENS.length);

    SPECIMENS.forEach((specimen, index) => {
      const tab = within(tabs[index]);
      expect(
        tab.getByText(en.landing.specimens[specimen.id].label)
      ).toBeInTheDocument();
      expect(tab.getByText(specimen.model)).toBeInTheDocument();
    });
  });

  it('shows the first specimen with its own outlines and honest alt text', async () => {
    const { container } = render(<Hero />);

    const panel = await screen.findByRole('tabpanel');
    const first = SPECIMENS[0];
    const image = within(panel).getByRole('img');

    expect(image).toHaveAttribute('src', first.image);
    expect(image).toHaveAttribute('alt', en.landing.specimens[first.id].alt);
    expect(
      within(panel).getByText(en.landing.specimens[first.id].detail)
    ).toBeInTheDocument();
    expect(panel.querySelectorAll('svg path')).toHaveLength(
      first.outlines.length
    );
    expect(container.textContent).not.toMatch(/landing\.specimens\./);
  });

  it('swaps the frame, the caption and the outlines when a specimen is picked', async () => {
    const user = userEvent.setup();
    render(<Hero />);

    const tabs = await screen.findAllByRole('tab');
    const target = SPECIMENS.findIndex(s => s.id === 'microtubule');
    await user.click(tabs[target]);

    const panel = screen.getByRole('tabpanel');
    const specimen = SPECIMENS[target];
    expect(within(panel).getByRole('img')).toHaveAttribute(
      'src',
      specimen.image
    );
    expect(within(panel).getByRole('img')).toHaveAttribute(
      'alt',
      en.landing.specimens[specimen.id].alt
    );
    expect(panel.querySelectorAll('svg path')).toHaveLength(
      specimen.outlines.length
    );
    expect(tabs[target]).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps a single tab in the tab order and moves selection with arrow keys', async () => {
    const user = userEvent.setup();
    render(<Hero />);

    const tabs = await screen.findAllByRole('tab');
    expect(
      tabs.filter(tab => tab.getAttribute('tabindex') === '0')
    ).toHaveLength(1);

    tabs[0].focus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('tab')[1]).toHaveAttribute(
      'aria-selected',
      'true'
    );

    await user.keyboard('{End}');
    expect(screen.getAllByRole('tab')[SPECIMENS.length - 1]).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });
});
