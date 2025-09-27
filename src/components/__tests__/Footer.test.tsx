import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { render } from '@/test/utils/test-utils';
import Footer from '@/components/Footer';

describe('Footer', () => {
  it('renders the footer component', () => {
    render(<Footer />);

    const footer = screen.getByRole('contentinfo');
    expect(footer).toBeInTheDocument();
  });

  it('displays the SpheroSeg logo and brand name', () => {
    render(<Footer />);

    expect(screen.getByText('SpheroSeg')).toBeInTheDocument();

    // Check for the microscope icon (via class or SVG)
    const logoContainer = document.querySelector('.bg-blue-500');
    expect(logoContainer).toBeInTheDocument();
  });

  it('displays the company description', () => {
    render(<Footer />);

    expect(
      screen.getByText(/Advanced spheroid segmentation and analysis platform/)
    ).toBeInTheDocument();
  });

  it('displays contact information', () => {
    render(<Footer />);

    // Email contact
    const emailLink = screen.getByRole('link', {
      name: 'spheroseg@utia.cas.cz',
    });
    expect(emailLink).toBeInTheDocument();
    expect(emailLink).toHaveAttribute('href', 'mailto:spheroseg@utia.cas.cz');

    // Institution - should display institution name from translations
    expect(screen.getByText(/ÚTIA AV ČR/)).toBeInTheDocument();

    // Address
    expect(
      screen.getByText('Pod Vodárenskou věží 4, 182 08 Prague 8')
    ).toBeInTheDocument();
  });

  it('displays Resources section with correct links', () => {
    render(<Footer />);

    expect(screen.getByText('Resources')).toBeInTheDocument();

    // Documentation link
    const docLink = screen.getByRole('link', { name: 'Documentation' });
    expect(docLink).toHaveAttribute('href', '/documentation');

    // Features link (anchor)
    const featuresLink = screen.getByRole('link', { name: 'Features' });
    expect(featuresLink).toHaveAttribute('href', '#features');

    // Other resource links
    expect(screen.getByRole('link', { name: 'Tutorials' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Research' })).toBeInTheDocument();
  });

  it('displays Legal section with correct links', () => {
    render(<Footer />);

    expect(screen.getByText('Legal')).toBeInTheDocument();

    // Terms of Service
    const termsLink = screen.getByRole('link', { name: 'Terms of Service' });
    expect(termsLink).toHaveAttribute('href', '/terms-of-service');

    // Privacy Policy
    const privacyLink = screen.getByRole('link', { name: 'Privacy Policy' });
    expect(privacyLink).toHaveAttribute('href', '/privacy-policy');

    // Contact Us (email)
    const contactLink = screen.getByRole('link', { name: 'Contact Us' });
    expect(contactLink).toHaveAttribute('href', 'mailto:spheroseg@utia.cas.cz');
  });

  it('displays copyright with current year', () => {
    render(<Footer />);

    const currentYear = new Date().getFullYear();
    const copyrightText = screen.getByText(
      new RegExp(`© ${currentYear} SpheroSeg`)
    );
    expect(copyrightText).toBeInTheDocument();
  });

  it('displays full institution name in copyright', () => {
    render(<Footer />);

    expect(
      screen.getByText(
        /Institute of Information Theory and Automation, Czech Academy of Sciences/
      )
    ).toBeInTheDocument();
  });

  it('has proper responsive grid layout', () => {
    render(<Footer />);

    const gridContainer = document.querySelector(
      '.grid.grid-cols-1.md\\:grid-cols-4'
    );
    expect(gridContainer).toBeInTheDocument();
  });

  it('applies correct styling classes', () => {
    render(<Footer />);

    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveClass('bg-gray-50', 'border-t', 'border-gray-200');

    const container = footer.querySelector('.container');
    expect(container).toHaveClass('mx-auto', 'px-4', 'py-12', 'md:py-16');
  });

  it('has hover effects on links', () => {
    render(<Footer />);

    const docLink = screen.getByRole('link', { name: 'Documentation' });
    expect(docLink).toHaveClass('hover:text-blue-600');

    const emailLink = screen.getByRole('link', {
      name: 'spheroseg@utia.cas.cz',
    });
    expect(emailLink).toHaveClass('hover:underline');
  });

  it('structures content sections properly', () => {
    render(<Footer />);

    // Check that sections have proper headings
    const resourcesHeading = screen.getByText('Resources');
    expect(resourcesHeading).toHaveClass(
      'text-sm',
      'font-semibold',
      'uppercase'
    );

    const legalHeading = screen.getByText('Legal');
    expect(legalHeading).toHaveClass('text-sm', 'font-semibold', 'uppercase');
  });

  it('has proper link accessibility', () => {
    render(<Footer />);

    // All links should have proper href attributes
    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThan(0);

    links.forEach(link => {
      expect(link).toHaveAttribute('href');
    });
  });

  it('separates copyright section with border', () => {
    render(<Footer />);

    const copyrightSection = document.querySelector(
      '.border-t.border-gray-200'
    );
    expect(copyrightSection).toBeInTheDocument();
    expect(copyrightSection).toHaveClass('mt-12', 'pt-8');
  });

  it('centers copyright text', () => {
    render(<Footer />);

    const copyrightText = screen.getByText(/© \d{4} SpheroSeg/);
    expect(copyrightText).toHaveClass('text-center');
  });

  it('has proper link structure for logo', () => {
    render(<Footer />);

    const logoLink = screen.getByRole('link', { name: 'SpheroSeg' });
    expect(logoLink).toHaveAttribute('href', '/');
    expect(logoLink).toHaveClass('flex', 'items-center', 'gap-2');
  });

  it('displays contact information with proper structure', () => {
    render(<Footer />);

    // Check for Contact label
    expect(screen.getByText('Contact:')).toBeInTheDocument();

    // Check for Institution label
    expect(screen.getByText('Institution:')).toBeInTheDocument();

    // Check for Address label
    expect(screen.getByText('Address:')).toBeInTheDocument();
  });

  it('has proper spacing between sections', () => {
    render(<Footer />);

    const grid = document.querySelector('.grid');
    expect(grid).toHaveClass('gap-8');

    const resourcesList = document.querySelector('ul');
    expect(resourcesList).toHaveClass('space-y-3');
  });

  it('uses semantic HTML elements', () => {
    render(<Footer />);

    // Footer should use semantic footer element
    const footer = screen.getByRole('contentinfo');
    expect(footer.tagName.toLowerCase()).toBe('footer');

    // Should have proper heading hierarchy
    const headings = screen.getAllByRole('heading');
    expect(headings.length).toBe(2); // Resources and Legal headings
  });
});
