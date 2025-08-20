import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render, mockIntersectionObserver } from '@/test/utils/test-utils';
import Hero from '@/components/Hero';

// Mock react-router-dom Link component
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    Link: ({ to, children, ...props }: any) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

describe('Hero', () => {
  beforeEach(() => {
    mockIntersectionObserver();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the hero section with proper structure', () => {
    render(<Hero />);

    const heroContainer = document.querySelector(
      '.min-h-screen.flex.items-center.justify-center'
    );
    expect(heroContainer).toBeInTheDocument();
  });

  it('displays translated hero badge text', () => {
    render(<Hero />);

    // The badge should contain translated text
    const badge = document.querySelector(
      '.glass-morphism.px-4.py-2.rounded-full'
    );
    expect(badge).toBeInTheDocument();
    expect(badge?.querySelector('.text-blue-600')).toBeInTheDocument();
  });

  it('displays translated hero title', () => {
    render(<Hero />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveClass(
      'text-4xl',
      'md:text-5xl',
      'lg:text-6xl',
      'font-bold',
      'text-gray-900',
      'leading-tight'
    );
  });

  it('displays translated subtitle', () => {
    render(<Hero />);

    const subtitle = document.querySelector(
      '.text-xl.text-gray-600.max-w-2xl.mx-auto'
    );
    expect(subtitle).toBeInTheDocument();
  });

  it('renders Get Started button with correct link', () => {
    render(<Hero />);

    const getStartedLink = screen.getByRole('link', { name: /get started/i });
    expect(getStartedLink).toBeInTheDocument();
    expect(getStartedLink).toHaveAttribute('href', '/sign-in');
  });

  it('renders Learn More button with anchor link', () => {
    render(<Hero />);

    const learnMoreLink = screen.getByRole('link', { name: /learn more/i });
    expect(learnMoreLink).toBeInTheDocument();
    expect(learnMoreLink).toHaveAttribute('href', '#features');
  });

  it('has proper button styling', () => {
    render(<Hero />);

    const buttons = screen.getAllByRole('link');

    // Get Started button should have primary styling
    const getStartedButton = buttons.find(
      button => button.getAttribute('href') === '/sign-in'
    );
    expect(getStartedButton).toHaveClass(
      'rounded-md',
      'text-base',
      'px-8',
      'py-6'
    );

    // Learn More button should have outline styling
    const learnMoreButton = buttons.find(
      button => button.getAttribute('href') === '#features'
    );
    expect(learnMoreButton).toHaveClass(
      'rounded-md',
      'text-base',
      'px-8',
      'py-6'
    );
  });

  it('displays ArrowRight icon in Get Started button', () => {
    render(<Hero />);

    const getStartedLink = screen.getByRole('link', { name: /get started/i });
    const arrowIcon = getStartedLink.querySelector('svg');
    expect(arrowIcon).toBeInTheDocument();
    expect(arrowIcon).toHaveClass('ml-2', 'h-5', 'w-5');
  });

  it('renders background floating elements', () => {
    render(<Hero />);

    const floatingElements = document.querySelectorAll('.animate-float');
    expect(floatingElements).toHaveLength(3);

    // Check styling of floating elements
    floatingElements.forEach(element => {
      expect(element).toHaveClass('rounded-full', 'filter', 'blur-3xl');
    });
  });

  it('has proper background gradient', () => {
    render(<Hero />);

    const backgroundContainer = document.querySelector(
      '.absolute.inset-0.-z-10'
    );
    expect(backgroundContainer).toBeInTheDocument();
  });

  it('renders microscopy images', () => {
    render(<Hero />);

    const images = document.querySelectorAll('img');
    expect(images).toHaveLength(2);

    images.forEach(img => {
      expect(img).toHaveAttribute('alt');
      expect(img).toHaveClass('w-full', 'h-auto', 'rounded-2xl');
    });
  });

  it('has proper image container styling', () => {
    render(<Hero />);

    const imageContainers = document.querySelectorAll(
      '.glass-morphism.rounded-2xl.shadow-glass-lg'
    );
    expect(imageContainers.length).toBeGreaterThanOrEqual(2);

    imageContainers.forEach(container => {
      expect(container).toHaveClass('relative', 'overflow-hidden');
    });
  });

  it('sets up IntersectionObserver correctly', () => {
    render(<Hero />);

    expect(window.IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      { threshold: 0.1 }
    );
  });

  it('observes the hero container element', () => {
    const mockObserve = vi.fn();
    vi.mocked(window.IntersectionObserver).mockImplementation(() => ({
      observe: mockObserve,
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));

    render(<Hero />);

    expect(mockObserve).toHaveBeenCalled();
  });

  it('cleans up IntersectionObserver on unmount', () => {
    const mockUnobserve = vi.fn();
    vi.mocked(window.IntersectionObserver).mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: mockUnobserve,
      disconnect: vi.fn(),
    }));

    const { unmount } = render(<Hero />);
    unmount();

    expect(mockUnobserve).toHaveBeenCalled();
  });

  it('has staggered animation classes', () => {
    render(<Hero />);

    const animatedContainer = document.querySelector('.staggered-fade-in');
    expect(animatedContainer).toBeInTheDocument();
  });

  it('has responsive button layout', () => {
    render(<Hero />);

    const buttonContainer = document.querySelector(
      '.flex.flex-col.sm\\:flex-row.gap-4.justify-center'
    );
    expect(buttonContainer).toBeInTheDocument();
  });

  it('has proper container structure', () => {
    render(<Hero />);

    const container = document.querySelector('.container.mx-auto.px-4.py-20');
    expect(container).toBeInTheDocument();

    const maxWidthContainer = document.querySelector(
      '.max-w-4xl.mx-auto.text-center'
    );
    expect(maxWidthContainer).toBeInTheDocument();
  });

  it('has proper spacing utilities', () => {
    render(<Hero />);

    const spacedContainer = document.querySelector('.space-y-8');
    expect(spacedContainer).toBeInTheDocument();

    const paddedSection = document.querySelector('.pt-4');
    expect(paddedSection).toBeInTheDocument();
  });

  it('has responsive text sizing', () => {
    render(<Hero />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveClass('text-4xl', 'md:text-5xl', 'lg:text-6xl');

    const subtitle = document.querySelector('.text-xl');
    expect(subtitle).toBeInTheDocument();
  });

  it('has proper grid layout for images', () => {
    render(<Hero />);

    const imageGrid = document.querySelector(
      '.grid.grid-cols-1.md\\:grid-cols-2.gap-8'
    );
    expect(imageGrid).toBeInTheDocument();
  });

  it('has hover effects on images', () => {
    render(<Hero />);

    const images = document.querySelectorAll('img');
    images.forEach(img => {
      expect(img).toHaveClass(
        'transform',
        'hover:scale-[1.01]',
        'transition-transform',
        'duration-500'
      );
    });
  });

  it('has overflow hidden for animations', () => {
    render(<Hero />);

    const container = document.querySelector('.overflow-hidden.pt-20');
    expect(container).toBeInTheDocument();
  });

  it('uses semantic HTML structure', () => {
    render(<Hero />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toBeInTheDocument();

    const links = screen.getAllByRole('link');
    expect(links.length).toBeGreaterThanOrEqual(2);
  });

  it('has proper z-index layering', () => {
    render(<Hero />);

    const backgroundLayer = document.querySelector('.-z-10');
    expect(backgroundLayer).toBeInTheDocument();
  });

  it('handles IntersectionObserver callback correctly', () => {
    const mockCallback = vi.fn();
    vi.mocked(window.IntersectionObserver).mockImplementation(callback => {
      mockCallback.mockImplementation(callback);
      return {
        observe: vi.fn(),
        unobserve: vi.fn(),
        disconnect: vi.fn(),
      };
    });

    render(<Hero />);

    // Simulate intersection
    const mockEntry = {
      isIntersecting: true,
      target: { classList: { add: vi.fn() } },
    };

    mockCallback([mockEntry]);
    expect(mockEntry.target.classList.add).toHaveBeenCalledWith('active');
  });

  it('has proper animation delays on floating elements', () => {
    render(<Hero />);

    const floatingElements = document.querySelectorAll('.animate-float');
    expect(floatingElements[1]).toHaveStyle({ animationDelay: '-2s' });
    expect(floatingElements[2]).toHaveStyle({ animationDelay: '-4s' });
  });

  it('has proper color schemes for floating elements', () => {
    render(<Hero />);

    const floatingElements = document.querySelectorAll('.animate-float');
    expect(floatingElements[0]).toHaveClass('bg-blue-200/30');
    expect(floatingElements[1]).toHaveClass('bg-blue-300/20');
    expect(floatingElements[2]).toHaveClass('bg-blue-400/20');
  });

  it('has gradient overlays on image containers', () => {
    render(<Hero />);

    const gradientOverlays = document.querySelectorAll(
      '.bg-gradient-to-r.from-blue-500\\/10.to-purple-500\\/10'
    );
    expect(gradientOverlays).toHaveLength(2);

    gradientOverlays.forEach(overlay => {
      expect(overlay).toHaveClass('absolute', 'inset-0');
    });
  });
});
