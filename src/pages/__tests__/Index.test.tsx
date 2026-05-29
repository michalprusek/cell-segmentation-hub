/**
 * Index (landing page) tests — 0% → covered.
 *
 * Behaviors tested:
 *  - About section renders with badge, title and contact email link.
 *  - Acknowledgments section renders badge and contributor name.
 *  - CTA section renders title and "Create Account" / "Get Started" link.
 *  - Navbar and Footer stubs mount.
 *  - Hero and Features stubs mount.
 *  - Segmented-spheroid image renders with alt text.
 *
 * NOT tested:
 *  - useScrollAnimation side effects (DOM scroll events, timing).
 *  - Animation CSS class application (visual-only).
 *  - Navbar/Footer/Hero/Features internals (mocked).
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
// useScrollAnimation attaches DOM events — stub it to a no-op
vi.mock('@/hooks/useScrollAnimation', () => ({
  useScrollAnimation: () => undefined,
}));

// useLanguage: needed because Index renders the About/Ack/CTA sections that
// call t(). Without LanguageProvider in tests, it throws.
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'landing.about.badge': 'Our Mission',
        'landing.about.title':
          'Advancing Biomedical Research Through Technology',
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
        'landing.cta.title': 'Ready to Transform Your Cell Analysis Workflow?',
        'landing.cta.subtitle': 'Join leading researchers.',
        'landing.cta.cardTitle': 'Get Started Today',
        'landing.cta.cardDescription': 'Sign up for a free account.',
        'landing.cta.createAccount': 'Create Account',
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
  });

  describe('About section', () => {
    it('renders the "Our Mission" badge', () => {
      renderPage();
      expect(screen.getByText('Our Mission')).toBeInTheDocument();
    });

    it('renders the about section heading', () => {
      renderPage();
      expect(
        screen.getByText('Advancing Biomedical Research Through Technology')
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

    it('renders the spheroid image with alt text', () => {
      renderPage();
      expect(screen.getByAltText('Segmented spheroid')).toBeInTheDocument();
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

  describe('CTA section', () => {
    it('renders the CTA heading', () => {
      renderPage();
      expect(
        screen.getByText('Ready to Transform Your Cell Analysis Workflow?')
      ).toBeInTheDocument();
    });

    it('renders the CTA card title', () => {
      renderPage();
      expect(screen.getByText('Get Started Today')).toBeInTheDocument();
    });

    it('renders a "Create Account" / sign-in link', () => {
      renderPage();
      // The link uses t('landing.cta.createAccount') = 'Create Account'
      const ctaLink = screen.getByRole('link', { name: /create account/i });
      expect(ctaLink).toBeInTheDocument();
      expect(ctaLink).toHaveAttribute('href', '/sign-in');
    });
  });
});
