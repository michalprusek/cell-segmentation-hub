/**
 * Features (landing "what it does" section).
 *
 * Assertions read the English dictionary rather than hard-coded copy, so
 * rewording a capability is a one-file change and cannot silently rot this
 * test. What is pinned is the wiring: every capability declared in the
 * component resolves a real translation key, and the anchor the hero's second
 * CTA points at exists.
 */
import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import Features from '@/components/Features';
import en from '@/translations/en';

const CARD_IDS = [
  'models',
  'stacks',
  'tracking',
  'corrections',
  'measurements',
  'batch',
] as const;

describe('Features', () => {
  it('renders the section heading and standfirst from the dictionary', async () => {
    render(<Features />);

    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: en.landing.features.title,
      })
    ).toBeInTheDocument();
    expect(screen.getByText(en.landing.features.badge)).toBeInTheDocument();
    expect(screen.getByText(en.landing.features.subtitle)).toBeInTheDocument();
  });

  it('renders one list item per capability, each with its title and description', async () => {
    const { container } = render(<Features />);

    const items = await screen.findAllByRole('listitem');
    expect(items).toHaveLength(CARD_IDS.length);

    CARD_IDS.forEach((id, index) => {
      const card = en.landing.features.cards[id];
      const item = within(items[index]);
      expect(
        item.getByRole('heading', { level: 3, name: card.title })
      ).toBeInTheDocument();
      expect(item.getByText(card.description)).toBeInTheDocument();
    });

    // No card may fall back to rendering its raw key.
    expect(container.textContent).not.toMatch(/landing\.features\./);
  });

  it('labels each capability with the object it operates on', async () => {
    render(<Features />);

    const items = await screen.findAllByRole('listitem');
    const tags = items.map(
      item =>
        within(item).getByText(/^(polygon|frame|track|vertex|roi|queue)$/)
          .textContent
    );
    expect(tags).toEqual([
      'polygon',
      'frame',
      'track',
      'vertex',
      'roi',
      'queue',
    ]);
  });

  it('exposes the #features anchor the hero links to', async () => {
    const { container } = render(<Features />);
    await screen.findAllByRole('listitem');

    expect(container.querySelector('section#features')).toBeInTheDocument();
  });
});
