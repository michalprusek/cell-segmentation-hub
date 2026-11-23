/**
 * Index (landing page).
 *
 * Behaviors tested:
 *  - Navbar / Hero / Features / Footer are composed onto the page.
 *  - About section renders its badge, heading, the developer's name linked
 *    to their staff page inside an unbroken sentence, the contact email link
 *    and the financial-support line, each pointing at the same mailto: address.
 *  - In every locale the bio here and the one in the in-app Documentation are
 *    both current (title, supervisors, institute).
 *  - Acknowledgments render the contributor's name and both links to their
 *    page — these are a real attribution, so the test pins them.
 *  - The sign-up band renders its heading and the link into /sign-in.
 *
 * NOT tested:
 *  - Hero / Features internals (mocked here, covered by their own suites).
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import Index from '../Index';
import en from '@/translations/en';
import cs from '@/translations/cs';
import es from '@/translations/es';
import de from '@/translations/de';
import fr from '@/translations/fr';
import zh from '@/translations/zh';

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
        // The real English strings: the test checks the sentence they join
        // into, so a stray or missing space at either seam fails it.
        'landing.about.developedByIntro': 'Our platform was developed by Ing.',
        'landing.about.developerName': 'Michal Průšek',
        'landing.about.developedByRest':
          ', a PhD student at the Faculty of Nuclear Sciences and Physical Engineering (FJFI) at Czech Technical University in Prague and a researcher at the Institute of Information Theory and Automation of the Czech Academy of Sciences (ÚTIA), under the supervision of Ing. Adam Novozámský, Ph.D., and Prof. Ing. Filip Šroubek, Ph.D., DSc.',
        'landing.about.description2': 'Description 2.',
        'landing.about.description3': 'Description 3.',
        'landing.about.contactText': 'For inquiries, please contact us at',
        'landing.about.supportText':
          'If you would like to support the project financially, please write to me at',
        'landing.citation.badge': 'Citation',
        'landing.citation.title': 'How to cite SpheroSeg',
        'landing.citation.intro': 'Please cite it. Choose the module you used:',
        'landing.citation.copyBibtex': 'Copy BibTeX',
        'landing.citation.copied': 'Copied',
        'landing.citation.copyFailed': 'Copy failed',
        'landing.citation.modulesLabel': 'Module',
        'landing.citation.otherModule': 'Other module / SpheroSeg as a whole',
        'projects.types.sperm': 'Sperm',
        'projects.types.spheroid': 'Spheroids (standard)',
        'projects.types.wound': 'Wound healing',
        'projects.types.microtubules': 'Microtubules',
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

  describe('How to cite', () => {
    it('sits between About and Acknowledgments', () => {
      renderPage();
      const about = document.getElementById('about');
      const cite = document.getElementById('cite');
      const ack = document.getElementById('acknowledgments');
      expect(about && cite && ack).toBeTruthy();
      expect(
        about!.compareDocumentPosition(cite!) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        cite!.compareDocumentPosition(ack!) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(
        screen.getByRole('heading', { level: 2, name: 'How to cite SpheroSeg' })
      ).toBeInTheDocument();
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

    it("links the developer's name to their page, inside one sentence", () => {
      renderPage();
      const link = screen.getByRole('link', { name: 'Michal Průšek' });
      expect(link).toHaveAttribute('href', 'https://staff.utia.cas.cz/prusek/');
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
      // In the About section, and the sentence reads as one, the name joined
      // to its title and its comma with exactly one space and none.
      expect(document.getElementById('about')!.contains(link)).toBe(true);
      expect(link.closest('p')!.textContent).toBe(
        'Our platform was developed by Ing. Michal Průšek, a PhD student at ' +
          'the Faculty of Nuclear Sciences and Physical Engineering (FJFI) at ' +
          'Czech Technical University in Prague and a researcher at the ' +
          'Institute of Information Theory and Automation of the Czech Academy ' +
          'of Sciences (ÚTIA), under the supervision of Ing. Adam Novozámský, ' +
          'Ph.D., and Prof. Ing. Filip Šroubek, Ph.D., DSc.'
      );
    });

    // Index puts the one space between intro and name itself, and none
    // between name and rest. A locale whose strings carry their own space
    // would render a double space or " ," in that language only.
    it.each(Object.entries({ en, cs, es, de, fr, zh }))(
      '%s: the developer sentence leaves its seams to the page',
      (_lang, tr) => {
        const { developedByIntro, developerName, developedByRest } =
          tr.landing.about;
        expect(developedByIntro).toMatch(/\S$/);
        expect(developerName).toMatch(/^\S.*\S$/);
        expect(developedByRest).toMatch(/^\S/);
      }
    );

    // The bio is written twice: here, and in the in-app Documentation's
    // introduction (`docs.introduction.developedBy`, one string because that
    // page renders and searches plain text). Both still said "Bc. … student"
    // after it had stopped being true, so per locale both must carry the
    // current title, both PhD supervisors and the institute. `Šroub` is a stem
    // on purpose: Czech declines the name ("pod vedením … Filipa Šroubka").
    it.each(Object.entries({ en, cs, es, de, fr, zh }))(
      '%s: the welcome page and the documentation give the current bio',
      (_lang, tr) => {
        const { developedByIntro, developedByRest } = tr.landing.about;
        // The title is the word the page sets right before the linked name;
        // the docs string carries both itself.
        expect(developedByIntro).toMatch(/Ing\.$/);
        expect(tr.docs.introduction.developedBy).toMatch(/Ing\. Michal Průšek/);
        const bios = {
          landing: `${developedByIntro} ${developedByRest}`,
          docs: tr.docs.introduction.developedBy,
        };
        for (const [where, bio] of Object.entries(bios)) {
          expect(bio, where).not.toMatch(/Bc\.|学士/);
          expect(bio, where).toMatch(/Novozámsk/);
          expect(bio, where).toMatch(/Šroub/);
          expect(bio, where).toMatch(/ÚTIA/);
        }
      }
    );

    // Two paragraphs now end in the same address, so each assertion is scoped
    // to its own <p>: an unscoped getByRole would match both and throw.
    it('renders the contact email link', () => {
      renderPage();
      const line = screen.getByText(/For inquiries, please contact us at/);
      const emailLink = within(line).getByRole('link', {
        name: /prusek@utia\.cas\.cz/i,
      });
      expect(emailLink).toHaveAttribute('href', 'mailto:prusek@utia.cas.cz');
    });

    it('invites financial support at the same address', () => {
      renderPage();
      const line = screen.getByText(/support the project financially/);
      const emailLink = within(line).getByRole('link', {
        name: /prusek@utia\.cas\.cz/i,
      });
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
