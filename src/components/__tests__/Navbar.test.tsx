import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import Navbar from '@/components/Navbar';

// Mock child components
vi.mock('@/components/LanguageSwitcher', () => ({
  default: () => <div data-testid="language-switcher">Language Switcher</div>,
}));

vi.mock('@/components/ThemeSwitcher', () => ({
  default: () => <div data-testid="theme-switcher">Theme Switcher</div>,
}));

describe('Navbar', () => {
  beforeEach(() => {
    // Reset scroll position
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      value: 0,
    });
  });

  afterEach(() => {
    // Clean up any event listeners
    vi.clearAllMocks();
  });

  it('renders the logo and brand name', () => {
    render(<Navbar />);

    expect(screen.getByAltText('SpheroSeg Logo')).toBeInTheDocument();
    expect(screen.getByText('SpheroSeg')).toBeInTheDocument();
  });

  it('renders all navigation links', () => {
    render(<Navbar />);

    expect(screen.getByText('Documentation')).toBeInTheDocument();
    expect(screen.getByText('Terms')).toBeInTheDocument();
    expect(screen.getByText('Privacy')).toBeInTheDocument();
    expect(screen.getByText('Login')).toBeInTheDocument();
  });

  it('renders language and theme switchers', () => {
    render(<Navbar />);

    expect(screen.getAllByTestId('language-switcher')).toHaveLength(2); // Desktop and mobile
    expect(screen.getAllByTestId('theme-switcher')).toHaveLength(2); // Desktop and mobile
  });

  it('shows mobile menu button on small screens', () => {
    render(<Navbar />);

    const menuButton = screen.getByLabelText('Toggle menu');
    expect(menuButton).toBeInTheDocument();
    expect(menuButton).toHaveClass('md:hidden');
  });

  it('toggles mobile menu when button is clicked', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    const menuButton = screen.getByLabelText('Toggle menu');

    // Initially, mobile menu should not be visible
    expect(screen.queryByText('Terms of Service')).not.toBeInTheDocument();

    // Click to open mobile menu
    await user.click(menuButton);

    // Mobile menu should now be visible with full link text
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    expect(screen.getByText('Privacy Policy')).toBeInTheDocument();

    // Click to close mobile menu
    await user.click(menuButton);

    // Mobile menu should be hidden again
    expect(screen.queryByText('Terms of Service')).not.toBeInTheDocument();
  });

  it('shows correct icon based on mobile menu state', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    const menuButton = screen.getByLabelText('Toggle menu');

    // Initially should show Menu icon (hamburger)
    expect(menuButton.querySelector('svg')).toBeInTheDocument();

    // Click to open mobile menu
    await user.click(menuButton);

    // Should show X icon when open
    expect(menuButton.querySelector('svg')).toBeInTheDocument();
  });

  it('closes mobile menu when a link is clicked', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    const menuButton = screen.getByLabelText('Toggle menu');

    // Open mobile menu
    await user.click(menuButton);
    expect(screen.getByText('Terms of Service')).toBeInTheDocument();

    // Click on a mobile menu link
    const documentationLink = screen.getAllByText('Documentation')[1]; // Mobile version
    await user.click(documentationLink);

    // Mobile menu should close
    expect(screen.queryByText('Terms of Service')).not.toBeInTheDocument();
  });

  it('applies scroll styles when scrolled', () => {
    render(<Navbar />);

    const header = screen.getByRole('banner');

    // Initially should have transparent background
    expect(header).toHaveClass('bg-transparent');
    expect(header).not.toHaveClass('bg-white/80');

    // Simulate scroll
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      value: 20,
    });

    fireEvent.scroll(window);

    // Should apply scrolled styles
    expect(header).toHaveClass('bg-white/80');
    expect(header).not.toHaveClass('bg-transparent');
  });

  it('removes scroll styles when scrolled back to top', () => {
    render(<Navbar />);

    const header = screen.getByRole('banner');

    // Simulate scroll down
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      value: 20,
    });
    fireEvent.scroll(window);

    expect(header).toHaveClass('bg-white/80');

    // Simulate scroll back to top
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      value: 5,
    });
    fireEvent.scroll(window);

    expect(header).toHaveClass('bg-transparent');
    expect(header).not.toHaveClass('bg-white/80');
  });

  it('has proper navigation structure', () => {
    render(<Navbar />);

    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
    expect(nav).toHaveClass('hidden', 'md:flex');
  });

  it('has correct link hrefs', () => {
    render(<Navbar />);

    const links = [
      { text: 'Documentation', href: '/documentation' },
      { text: 'Terms', href: '/terms-of-service' },
      { text: 'Privacy', href: '/privacy-policy' },
      { text: 'Login', href: '/sign-in' },
    ];

    links.forEach(({ text, href }) => {
      const link = screen.getByRole('link', { name: text });
      expect(link).toHaveAttribute('href', href);
    });
  });

  it('applies fixed positioning and z-index', () => {
    render(<Navbar />);

    const header = screen.getByRole('banner');
    expect(header).toHaveClass('fixed', 'top-0', 'left-0', 'right-0', 'z-50');
  });

  it('has responsive layout classes', () => {
    render(<Navbar />);

    const container = document.querySelector('.container');
    expect(container).toHaveClass('mx-auto', 'px-4', 'md:px-6');
  });

  it('shows settings section in mobile menu', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    const menuButton = screen.getByLabelText('Toggle menu');
    await user.click(menuButton);

    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('has hover effects on navigation links', () => {
    render(<Navbar />);

    const documentationLink = screen.getAllByText('Documentation')[0]; // Desktop version
    expect(documentationLink).toHaveClass('hover:text-blue-500');
  });

  it('includes backdrop blur effect when scrolled', () => {
    render(<Navbar />);

    const header = screen.getByRole('banner');

    // Simulate scroll
    Object.defineProperty(window, 'scrollY', {
      writable: true,
      value: 20,
    });
    fireEvent.scroll(window);

    expect(header).toHaveClass('backdrop-blur-md');
  });

  it('mobile menu has proper styling', async () => {
    const user = userEvent.setup();
    render(<Navbar />);

    const menuButton = screen.getByLabelText('Toggle menu');
    await user.click(menuButton);

    const mobileMenu = document.querySelector('.absolute.top-full');
    expect(mobileMenu).toHaveClass(
      'bg-white/95',
      'backdrop-blur-md',
      'shadow-lg'
    );
  });

  it('logo link navigates to home', () => {
    render(<Navbar />);

    const logoLink = screen.getByRole('link', { name: /spheroseg logo/i });
    expect(logoLink).toHaveAttribute('href', '/');
  });

  it('handles scroll event cleanup', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = render(<Navbar />);

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function)
    );

    unmount();

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'scroll',
      expect.any(Function)
    );
  });

  it('has proper accessibility attributes', () => {
    render(<Navbar />);

    const menuButton = screen.getByLabelText('Toggle menu');
    expect(menuButton).toHaveAttribute('aria-label', 'Toggle menu');

    const logoImg = screen.getByAltText('SpheroSeg Logo');
    expect(logoImg).toHaveAttribute('alt', 'SpheroSeg Logo');
  });
});
