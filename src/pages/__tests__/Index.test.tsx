/**
 * Index (landing page).
 *
 * Behaviors tested:
 *  - Navbar / Hero / Features / Footer are composed onto the page.
 *  - About section renders its badge, heading and the contact email link.
 *  - Acknowledgments render the contributor's name and both links to their
 *    page — these are a real attribution, so the test pins them.
 *  - The sign-up band renders its heading and the link into /sign-in.
 *
 * NOT tested:
 *  - Hero / Features internals (mocked here, covered by their own suites).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import Index from '../Index';

// ---------------------------------------------------------------------------
// Stub heavy child components and context
// ---------------------------------------------------------------------------
vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));
vi.mock('@/components/Footer', () => ({
  default: () => <footer data-testid="footer" />,
}));
vi.mock('@/components/Hero', () => ({
  default: () => <section data-testid="hero" />,
}));
vi.mock('@/components/Features', () => ({
  default: () => <section data-testid="features" />,
}));

// useLanguage: needed because Index renders the About/Ack/CTA sections that
// call t(). Without LanguageProvider in tests, it throws.
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'landing.about.badge': 'Who builds it',
        'landing.about.title': 'Where the platform comes from',
        'landing.about.description1': 'Description 1.',
        'landing.about.description2': 'Description 2.',
        'landing.about.description3': 'Description 3.',
        'landing.about.contactText': 'For inquiries, please contact us at',
        'landing.acknowledgments.badge': 'Acknowledgments',
        'landing.acknowledgments.title': 'Special Thanks',
        'landing.acknowledgments.lukasIntro': 'We thank',
        'landing.acknowledgments.lukasName': 'Lukáš Veškrna',
        'landing.acknowledgments.lukasContribution':
          'for contributing the wound module.',
        'landing.acknowledgments.visitPage': 'Visit page',
        'landing.cta.title': 'Bring your own images.',
        'landing.cta.subtitle': 'Create a project and upload a stack.',
        'landing.cta.cardDescription': 'Sign-up is open',
        'landing.cta.createAccount': 'Create your account',
      };
      return map[key] ?? key;
    },
  }),
}));

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
function renderPage() {
  return render(
    <MemoryRouter>
      <Index />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Index (landing) page', () => {
  describe('Layout structure', () => {
    it('renders Navbar, Hero, Features and Footer stubs', () => {
      renderPage();
      expect(screen.getByTestId('navbar')).toBeInTheDocument();
      expect(screen.getByTestId('hero')).toBeInTheDocument();
      expect(screen.getByTestId('features')).toBeInTheDocument();
      expect(screen.getByTestId('footer')).toBeInTheDocument();
    });

    it('resolves every translation key it renders', () => {
      const { container } = renderPage();
      expect(container.textContent).not.toMatch(/landing\./);
    });
  });

  describe('About section', () => {
    it('renders the badge and heading', () => {
      renderPage();
      expect(screen.getByText('Who builds it')).toBeInTheDocument();
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Where the platform comes from',
        })
      ).toBeInTheDocument();
    });

    it('renders the contact email link', () => {
      renderPage();
      const emailLink = screen.getByRole('link', {
        name: /prusek@utia\.cas\.cz/i,
      });
      expect(emailLink).toBeInTheDocument();
      expect(emailLink).toHaveAttribute('href', 'mailto:prusek@utia.cas.cz');
    });
  });

  describe('Acknowledgments section', () => {
    it('renders the Acknowledgments badge', () => {
      renderPage();
      expect(screen.getByText('Acknowledgments')).toBeInTheDocument();
    });

    it('renders the "Special Thanks" heading', () => {
      renderPage();
      expect(screen.getByText('Special Thanks')).toBeInTheDocument();
    });

    it('renders contributor name with link to personal page', () => {
      renderPage();
      // The name appears as a link to veskrna.matfyz.cz
      const links = screen.getAllByRole('link', { name: /lukáš veškrna/i });
      expect(links.length).toBeGreaterThanOrEqual(1);
      expect(links[0]).toHaveAttribute('href', 'https://veskrna.matfyz.cz');
    });

    it('renders "Visit page" link', () => {
      renderPage();
      const visitLink = screen.getByRole('link', { name: /visit page/i });
      expect(visitLink).toHaveAttribute('href', 'https://veskrna.matfyz.cz');
      expect(visitLink).toHaveAttribute('target', '_blank');
      expect(visitLink).toHaveAttribute('rel', 'noopener noreferrer');
    });
  });

  describe('Sign-up band', () => {
    it('renders the heading and standfirst', () => {
      renderPage();
      expect(
        screen.getByRole('heading', {
          level: 2,
          name: 'Bring your own images.',
        })
      ).toBeInTheDocument();
      expect(
        screen.getByText('Create a project and upload a stack.')
      ).toBeInTheDocument();
    });

    it('renders the sign-up link', () => {
      renderPage();
      const ctaLink = screen.getByRole('link', {
        name: /create your account/i,
      });
      expect(ctaLink).toBeInTheDocument();
      expect(ctaLink).toHaveAttribute('href', '/sign-in');
    });
  });
});
