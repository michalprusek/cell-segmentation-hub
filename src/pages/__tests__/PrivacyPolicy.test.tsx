/**
 * PrivacyPolicy.tsx — static legal page: sections, navigation links.
 *
 * Run with:
 *   NODE_OPTIONS=--max-old-space-size=4096 npx vitest run \
 *     src/pages/__tests__/PrivacyPolicy.test.tsx --reporter=dot
 *
 * Strategy:
 *   - Navbar and Footer are stubbed.
 *   - useLanguage returns a minimal translation map with array-valued keys
 *     (the real translations provide arrays for list items — the component
 *     maps over them).
 *   - Tests verify all major h2 section headings, the disclaimer banner,
 *     the personal-info list items, the ML-training notice, navigation links.
 *
 * Behaviors tested:
 *   - Page title h1 rendered.
 *   - "Last updated" text rendered.
 *   - Disclaimer banner rendered.
 *   - All major h2 sections rendered (Introduction, Information We Collect,
 *     ML Training, How We Use, Data Security, Data Sharing, Privacy Rights,
 *     Data Retention, International Transfers, Children's Privacy, Policy
 *     Changes, Contact).
 *   - Personal-info list items rendered (t returns an array).
 *   - Back to Home button links to /.
 *   - Terms of Service button links to /terms-of-service.
 *
 * NOT tested:
 *   - Navbar/Footer internals (stubs).
 *   - Dynamic privacy consent toggles (handled by Settings page, not here).
 */

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/contexts/useLanguage', () => ({
  useLanguage: () => ({
    t: (key: string) => {
      const MAP: Record<string, string | string[]> = {
        'legal.privacy.title': 'Privacy Policy',
        'legal.privacy.lastUpdated': 'Last updated: January 2025',
        'legal.privacy.disclaimer':
          'Your privacy is important to us. This policy explains how we collect, use, and protect your data.',
        'legal.privacy.sections.introduction.title': '1. Introduction',
        'legal.privacy.sections.introduction.content':
          'This policy governs ...',
        'legal.privacy.sections.informationCollected.title':
          '2. Information We Collect',
        'legal.privacy.sections.informationCollected.content':
          'We collect info ...',
        'legal.privacy.sections.informationCollected.personalInfo.title':
          '2.1 Personal Information',
        'legal.privacy.sections.informationCollected.personalInfo.items': [
          'Email address',
          'Username',
          'Institution',
        ],
        'legal.privacy.sections.informationCollected.researchData.title':
          '2.2 Research Data',
        'legal.privacy.sections.informationCollected.researchData.ownershipTitle':
          'Your Data Belongs to You',
        'legal.privacy.sections.informationCollected.researchData.ownershipContent':
          'You retain full ownership.',
        'legal.privacy.sections.informationCollected.researchData.items': [
          'Uploaded images',
          'Segmentation results',
        ],
        'legal.privacy.sections.informationCollected.usageInfo.title':
          '2.3 Usage Information',
        'legal.privacy.sections.informationCollected.usageInfo.items': [
          'Log data',
          'Browser info',
        ],
        'legal.privacy.sections.mlTraining.title': '3. ML Training',
        'legal.privacy.sections.mlTraining.importantTitle': 'Important Notice',
        'legal.privacy.sections.mlTraining.importantIntro':
          'ML training intro.',
        'legal.privacy.sections.mlTraining.controlTitle': 'You control:',
        'legal.privacy.sections.mlTraining.controlContent': 'Opt-in/out.',
        'legal.privacy.sections.mlTraining.manageTitle': 'Manage:',
        'legal.privacy.sections.mlTraining.manageContent': 'In settings.',
        'legal.privacy.sections.mlTraining.howWeUse.title': 'How We Use',
        'legal.privacy.sections.mlTraining.howWeUse.items': [
          'Improve models',
          'Research',
        ],
        'legal.privacy.sections.mlTraining.protection.title': 'Protection',
        'legal.privacy.sections.mlTraining.protection.items': [
          'Anonymized',
          'Encrypted',
        ],
        'legal.privacy.sections.howWeUse.title': '4. How We Use Your Data',
        'legal.privacy.sections.howWeUse.content': 'We use data for ...',
        'legal.privacy.sections.howWeUse.purposes': [
          'Provide service',
          'Improve platform',
        ],
        'legal.privacy.sections.dataSecurity.title': '5. Data Security',
        'legal.privacy.sections.dataSecurity.content': 'We protect data ...',
        'legal.privacy.sections.dataSecurity.measures': [
          'Encryption',
          'Access controls',
        ],
        'legal.privacy.sections.dataSharing.title': '6. Data Sharing',
        'legal.privacy.sections.dataSharing.noSaleStatement':
          'We do not sell your data.',
        'legal.privacy.sections.dataSharing.sharingContent':
          'Limited sharing only.',
        'legal.privacy.sections.dataSharing.circumstances': [
          'Legal requirements',
          'Service providers',
        ],
        'legal.privacy.sections.privacyRights.title': '7. Your Privacy Rights',
        'legal.privacy.sections.privacyRights.content': 'You have rights ...',
        'legal.privacy.sections.privacyRights.rights': [
          'Access',
          'Deletion',
          'Portability',
        ],
        'legal.privacy.sections.privacyRights.contactNote': 'Contact us ...',
        'legal.privacy.sections.dataRetention.title': '8. Data Retention',
        'legal.privacy.sections.dataRetention.content': 'We retain data ...',
        'legal.privacy.sections.dataRetention.categories': [
          'Account data: until deletion',
          'Research data: until deleted',
        ],
        'legal.privacy.sections.internationalTransfers.title':
          '9. International Transfers',
        'legal.privacy.sections.internationalTransfers.content':
          'Data stored in EU.',
        'legal.privacy.sections.childrensPrivacy.title':
          "10. Children's Privacy",
        'legal.privacy.sections.childrensPrivacy.content':
          'Not for children under 13.',
        'legal.privacy.sections.policyChanges.title': '11. Policy Changes',
        'legal.privacy.sections.policyChanges.content': 'We may update ...',
        'legal.privacy.sections.contact.title': '12. Contact Us',
        'legal.privacy.sections.contact.dpo': 'DPO: dpo@example.com',
        'legal.privacy.sections.contact.general': 'General: info@example.com',
        'legal.privacy.sections.contact.postal': 'Postal address:',
        'legal.privacy.sections.contact.address.line1': 'Line 1',
        'legal.privacy.sections.contact.address.line2': 'Line 2',
        'legal.privacy.sections.contact.address.line3': 'Line 3',
        'legal.privacy.sections.contact.address.line4': 'Line 4',
        'legal.privacy.navigation.backToHome': 'Back to Home',
        'legal.privacy.navigation.termsOfService': 'Terms of Service',
      };
      const val = MAP[key];
      // Return arrays as-is; strings as strings; unknown keys as the key itself.
      if (Array.isArray(val)) return val as unknown as string;
      return (val as string | undefined) ?? key;
    },
  }),
}));

vi.mock('@/components/Navbar', () => ({
  default: () => <nav data-testid="navbar" />,
}));

vi.mock('@/components/Footer', () => ({
  default: () => <footer data-testid="footer" />,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    asChild,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
  }) => (asChild ? <>{children}</> : <button>{children}</button>),
}));

import PrivacyPolicy from '../PrivacyPolicy';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function renderPage() {
  return render(
    <MemoryRouter>
      <PrivacyPolicy />
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrivacyPolicy — page header', () => {
  it('renders the h1 title "Privacy Policy"', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: 'Privacy Policy', level: 1 })
    ).toBeInTheDocument();
  });

  it('renders the last-updated text', () => {
    renderPage();
    expect(screen.getByText('Last updated: January 2025')).toBeInTheDocument();
  });

  it('renders the disclaimer banner', () => {
    renderPage();
    expect(
      screen.getByText(
        'Your privacy is important to us. This policy explains how we collect, use, and protect your data.'
      )
    ).toBeInTheDocument();
  });
});

describe('PrivacyPolicy — section headings', () => {
  const headings = [
    '1. Introduction',
    '2. Information We Collect',
    '3. ML Training',
    '4. How We Use Your Data',
    '5. Data Security',
    '6. Data Sharing',
    '7. Your Privacy Rights',
    '8. Data Retention',
    '9. International Transfers',
    "10. Children's Privacy",
    '11. Policy Changes',
    '12. Contact Us',
  ];

  for (const heading of headings) {
    it(`renders section heading "${heading}"`, () => {
      renderPage();
      expect(
        screen.getByRole('heading', { name: heading, level: 2 })
      ).toBeInTheDocument();
    });
  }
});

describe('PrivacyPolicy — list items rendered from array translations', () => {
  it('renders personal-info list items', () => {
    renderPage();
    expect(screen.getByText('Email address')).toBeInTheDocument();
    expect(screen.getByText('Username')).toBeInTheDocument();
    expect(screen.getByText('Institution')).toBeInTheDocument();
  });

  it('renders research-data list items', () => {
    renderPage();
    expect(screen.getByText('Uploaded images')).toBeInTheDocument();
    expect(screen.getByText('Segmentation results')).toBeInTheDocument();
  });

  it('renders data-security measures', () => {
    renderPage();
    expect(screen.getByText('Encryption')).toBeInTheDocument();
    expect(screen.getByText('Access controls')).toBeInTheDocument();
  });

  it('renders privacy rights', () => {
    renderPage();
    expect(screen.getByText('Access')).toBeInTheDocument();
    expect(screen.getByText('Deletion')).toBeInTheDocument();
    expect(screen.getByText('Portability')).toBeInTheDocument();
  });
});

describe('PrivacyPolicy — ML training notice', () => {
  it('renders the "Important Notice" title in the amber box', () => {
    renderPage();
    expect(screen.getByText('Important Notice')).toBeInTheDocument();
  });

  it('renders "Your Data Belongs to You" ownership title', () => {
    renderPage();
    expect(screen.getByText('Your Data Belongs to You')).toBeInTheDocument();
  });
});

describe('PrivacyPolicy — navigation links', () => {
  it('Back to Home link has href="/"', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Back to Home' });
    expect(link).toHaveAttribute('href', '/');
  });

  it('Terms of Service link has href="/terms-of-service"', () => {
    renderPage();
    const link = screen.getByRole('link', { name: 'Terms of Service' });
    expect(link).toHaveAttribute('href', '/terms-of-service');
  });
});

describe('PrivacyPolicy — Navbar and Footer', () => {
  it('renders Navbar', () => {
    renderPage();
    expect(screen.getByTestId('navbar')).toBeInTheDocument();
  });

  it('renders Footer', () => {
    renderPage();
    expect(screen.getByTestId('footer')).toBeInTheDocument();
  });
});

describe('PrivacyPolicy — contact section', () => {
  it('renders DPO contact information', () => {
    renderPage();
    expect(screen.getByText('DPO: dpo@example.com')).toBeInTheDocument();
  });

  it('renders postal address text in the contact section', () => {
    renderPage();
    // The address lines are rendered inline with <br> siblings inside a <p>,
    // so `getByText` won't find them as isolated nodes. We assert the full
    // body text contains the address content.
    const allText = document.body.textContent ?? '';
    expect(allText).toContain('Postal address:');
    expect(allText).toContain('Line 1');
    expect(allText).toContain('Line 4');
  });

  it('renders "We do not sell your data." no-sale statement', () => {
    renderPage();
    expect(screen.getByText('We do not sell your data.')).toBeInTheDocument();
  });
});
