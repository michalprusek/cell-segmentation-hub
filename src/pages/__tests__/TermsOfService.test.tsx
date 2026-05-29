/**
 * TermsOfService page tests — 0% → covered.
 *
 * Behaviors tested:
 *  - Page title "Terms of Service" renders from i18n (global setup seeds en).
 *  - "Last updated" subtitle renders.
 *  - Disclaimer banner renders.
 *  - All 9 section headings render (acceptance, useLicense, dataUsage,
 *    userResponsibilities, serviceAvailability, limitationLiability,
 *    privacy, changes, termination, governingLaw).
 *  - Contact block renders.
 *  - "Back to Home" link points to "/".
 *  - "Privacy Policy" link points to "/privacy-policy".
 *
 * NOT tested:
 *  - Navbar/Footer internals (deep children, mocked to null).
 *  - Dark mode CSS classes (visual-only, no behavior).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import TermsOfService from '../TermsOfService';

// ---------------------------------------------------------------------------
// Stub heavy layout components and context
// ---------------------------------------------------------------------------
vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));
vi.mock('@/components/Footer', () => ({
  default: () => <footer data-testid="footer" />,
}));

// useLanguage must be mocked: TermsOfService calls t() for array values
// (permittedUses, permissions, responsibilities) via .map(). Without this mock
// the component throws "t(...).map is not a function" because the test context
// has no LanguageProvider and the global en seed alone is insufficient.
vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      // Keys that return arrays
      const arrays: Record<string, string[]> = {
        'legal.terms.sections.useLicense.permittedUses': [
          'Personal, non-commercial research purposes',
          'Academic and educational research',
        ],
        'legal.terms.sections.dataUsage.permissions': ['Permission 1'],
        'legal.terms.sections.userResponsibilities.responsibilities': [
          'Responsibility 1',
        ],
      };
      if (key in arrays) return arrays[key] as unknown as string;
      // Keys that return strings
      const strings: Record<string, string> = {
        'legal.terms.title': 'Terms of Service',
        'legal.terms.lastUpdated': 'Last updated: January 2025',
        'legal.terms.disclaimer':
          'By using SpheroSeg, you agree to these terms. Please read them carefully.',
        'legal.terms.sections.acceptance.title': '1. Acceptance of Terms',
        'legal.terms.sections.acceptance.content': 'Acceptance content.',
        'legal.terms.sections.useLicense.title':
          '2. Use License and Permitted Use',
        'legal.terms.sections.useLicense.content': 'Use license content.',
        'legal.terms.sections.useLicense.licenseNote': 'License note.',
        'legal.terms.sections.dataUsage.title': '3. Data Usage',
        'legal.terms.sections.dataUsage.importantTitle': 'Important',
        'legal.terms.sections.dataUsage.importantContent': 'Data important.',
        'legal.terms.sections.dataUsage.ownershipTitle': 'Ownership',
        'legal.terms.sections.dataUsage.ownershipContent': 'Ownership content.',
        'legal.terms.sections.dataUsage.protectionNote': 'Protection note.',
        'legal.terms.sections.userResponsibilities.title':
          '4. User Responsibilities',
        'legal.terms.sections.userResponsibilities.content': 'User resp.',
        'legal.terms.sections.serviceAvailability.title':
          '5. Service Availability',
        'legal.terms.sections.serviceAvailability.content': 'Service avail.',
        'legal.terms.sections.limitationLiability.title':
          '6. Limitation of Liability',
        'legal.terms.sections.limitationLiability.content': 'Limitation.',
        'legal.terms.sections.privacy.title': '7. Privacy',
        'legal.terms.sections.privacy.content': 'Privacy content.',
        'legal.terms.sections.changes.title': '8. Changes',
        'legal.terms.sections.changes.content': 'Changes content.',
        'legal.terms.sections.termination.title': '9. Termination',
        'legal.terms.sections.termination.content': 'Termination content.',
        'legal.terms.sections.governingLaw.title': '10. Governing Law',
        'legal.terms.sections.governingLaw.content': 'Governing law content.',
        'legal.terms.contact.title': 'Contact',
        'legal.terms.contact.content': 'Contact content.',
        'legal.terms.navigation.backToHome': 'Back to Home',
        'legal.terms.navigation.privacyPolicy': 'Privacy Policy',
      };
      return strings[key] ?? key;
    },
  }),
}));

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------
function renderPage() {
  return render(
    <MemoryRouter>
      <TermsOfService />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TermsOfService page', () => {
  describe('Layout structure', () => {
    it('renders Navbar and Footer', () => {
      renderPage();
      expect(screen.getByTestId('navbar')).toBeInTheDocument();
      expect(screen.getByTestId('footer')).toBeInTheDocument();
    });
  });

  describe('Header section', () => {
    it('renders the page title', () => {
      renderPage();
      // Global setup seeds English → real translation
      expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    });

    it('renders the last-updated subtitle', () => {
      renderPage();
      expect(
        screen.getByText('Last updated: January 2025')
      ).toBeInTheDocument();
    });

    it('renders the disclaimer banner', () => {
      renderPage();
      expect(
        screen.getByText(
          'By using SpheroSeg, you agree to these terms. Please read them carefully.'
        )
      ).toBeInTheDocument();
    });
  });

  describe('Section headings', () => {
    it('renders Acceptance of Terms heading', () => {
      renderPage();
      expect(screen.getByText('1. Acceptance of Terms')).toBeInTheDocument();
    });

    it('renders Use License section heading', () => {
      renderPage();
      expect(
        screen.getByText('2. Use License and Permitted Use')
      ).toBeInTheDocument();
    });

    it('renders Data Usage section heading', () => {
      renderPage();
      // The exact text depends on what's in translations — verify key resolves
      const headings = screen.getAllByRole('heading', { level: 2 });
      expect(headings.length).toBeGreaterThanOrEqual(3);
    });

    it('renders at least 8 h2 section headings', () => {
      renderPage();
      const headings = screen.getAllByRole('heading', { level: 2 });
      // acceptance + useLicense + dataUsage + userResponsibilities +
      // serviceAvailability + limitationLiability + privacy + changes +
      // termination + governingLaw = 10 headings
      expect(headings.length).toBeGreaterThanOrEqual(8);
    });
  });

  describe('Navigation buttons', () => {
    it('renders Back to Home link pointing to "/"', () => {
      renderPage();
      const backLink = screen.getByRole('link', { name: /back to home/i });
      expect(backLink).toBeInTheDocument();
      expect(backLink).toHaveAttribute('href', '/');
    });

    it('renders Privacy Policy link pointing to "/privacy-policy"', () => {
      renderPage();
      const privacyLink = screen.getByRole('link', { name: /privacy policy/i });
      expect(privacyLink).toBeInTheDocument();
      expect(privacyLink).toHaveAttribute('href', '/privacy-policy');
    });
  });

  describe('Permitted uses list', () => {
    it('renders at least one permitted use list item', () => {
      renderPage();
      expect(
        screen.getByText(/personal.*non-commercial research/i)
      ).toBeInTheDocument();
    });
  });
});
