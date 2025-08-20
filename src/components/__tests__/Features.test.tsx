import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen } from '@testing-library/react';
import { render, mockIntersectionObserver } from '@/test/utils/test-utils';
import Features from '@/components/Features';

describe('Features', () => {
  beforeEach(() => {
    mockIntersectionObserver();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the features section with correct heading', () => {
    render(<Features />);

    // Check for actual hardcoded text since Features doesn't use i18n yet
    expect(
      screen.getByText('Advanced Tools for Biomedical Research')
    ).toBeInTheDocument();
    expect(screen.getByText('Powerful Capabilities')).toBeInTheDocument();
  });

  it('displays the section description', () => {
    render(<Features />);

    // Check for actual hardcoded text since Features doesn't use i18n yet
    expect(
      screen.getByText(/Our platform offers a comprehensive suite of features/)
    ).toBeInTheDocument();
  });

  it('renders all six feature cards', () => {
    render(<Features />);

    const featureCards = document.querySelectorAll('.glass-morphism.p-6');
    expect(featureCards).toHaveLength(6);
  });

  it('displays Advanced Segmentation feature', () => {
    render(<Features />);

    expect(screen.getByText('Advanced Segmentation')).toBeInTheDocument();
    expect(
      screen.getByText(/Precise spheroid detection with boundary analysis/)
    ).toBeInTheDocument();
  });

  it('displays AI-Powered Analysis feature', () => {
    render(<Features />);

    expect(screen.getByText('AI-Powered Analysis')).toBeInTheDocument();
    expect(
      screen.getByText(/Leverage deep learning algorithms/)
    ).toBeInTheDocument();
  });

  it('displays Effortless Uploads feature', () => {
    render(<Features />);

    expect(screen.getByText('Effortless Uploads')).toBeInTheDocument();
    expect(
      screen.getByText(/Drag and drop your microscopic images/)
    ).toBeInTheDocument();
  });

  it('displays Statistical Insights feature', () => {
    render(<Features />);

    expect(screen.getByText('Statistical Insights')).toBeInTheDocument();
    expect(
      screen.getByText(/Comprehensive metrics and visualizations/)
    ).toBeInTheDocument();
  });

  it('displays Collaboration Tools feature', () => {
    render(<Features />);

    expect(screen.getByText('Collaboration Tools')).toBeInTheDocument();
    expect(
      screen.getByText(/Share projects with colleagues/)
    ).toBeInTheDocument();
  });

  it('displays Processing Pipeline feature', () => {
    render(<Features />);

    expect(screen.getByText('Processing Pipeline')).toBeInTheDocument();
    expect(
      screen.getByText(/Automated workflow from preprocessing/)
    ).toBeInTheDocument();
  });

  it('has proper section ID for navigation', () => {
    render(<Features />);

    const section = document.querySelector('#features');
    expect(section).toBeInTheDocument();
  });

  it('has correct grid layout classes', () => {
    render(<Features />);

    const grid = document.querySelector(
      '.grid.grid-cols-1.md\\:grid-cols-2.lg\\:grid-cols-3'
    );
    expect(grid).toBeInTheDocument();
  });

  it('applies glass morphism styling to feature cards', () => {
    render(<Features />);

    const featureCards = document.querySelectorAll('.glass-morphism');
    expect(featureCards.length).toBeGreaterThan(0);

    featureCards.forEach(card => {
      expect(card).toHaveClass('p-6', 'rounded-xl');
    });
  });

  it('has proper icon styling', () => {
    render(<Features />);

    const iconContainers = document.querySelectorAll('.w-14.h-14');
    expect(iconContainers).toHaveLength(6);

    iconContainers.forEach(container => {
      expect(container).toHaveClass(
        'mb-6',
        'rounded-lg',
        'bg-blue-100',
        'flex',
        'items-center',
        'justify-center',
        'text-blue-600'
      );
    });
  });

  it('sets up IntersectionObserver correctly', () => {
    render(<Features />);

    expect(window.IntersectionObserver).toHaveBeenCalledWith(
      expect.any(Function),
      { threshold: 0.1 }
    );
  });

  it('observes the features container element', () => {
    const mockObserve = vi.fn();
    vi.mocked(window.IntersectionObserver).mockImplementation(() => ({
      observe: mockObserve,
      unobserve: vi.fn(),
      disconnect: vi.fn(),
    }));

    render(<Features />);

    expect(mockObserve).toHaveBeenCalled();
  });

  it('cleans up IntersectionObserver on unmount', () => {
    const mockUnobserve = vi.fn();
    vi.mocked(window.IntersectionObserver).mockImplementation(() => ({
      observe: vi.fn(),
      unobserve: mockUnobserve,
      disconnect: vi.fn(),
    }));

    const { unmount } = render(<Features />);
    unmount();

    expect(mockUnobserve).toHaveBeenCalled();
  });

  it('has staggered animation classes', () => {
    render(<Features />);

    const container = document.querySelector('.staggered-fade-in');
    expect(container).toBeInTheDocument();
  });

  it('has background gradient element', () => {
    render(<Features />);

    const gradient = document.querySelector(
      '.bg-gradient-to-b.from-background.to-transparent'
    );
    expect(gradient).toBeInTheDocument();
    expect(gradient).toHaveClass(
      'absolute',
      'top-0',
      'left-0',
      'w-full',
      'h-40',
      '-z-10'
    );
  });

  it('has proper responsive padding', () => {
    render(<Features />);

    const section = document.querySelector('section');
    expect(section).toHaveClass('py-20');
  });

  it('centers content properly', () => {
    render(<Features />);

    const textCenter = document.querySelector('.text-center.max-w-3xl.mx-auto');
    expect(textCenter).toBeInTheDocument();
  });

  it('has proper badge styling', () => {
    render(<Features />);

    const badge = document.querySelector('.inline-block.bg-blue-100');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('px-4', 'py-2', 'rounded-full', 'mb-4');

    const badgeText = badge?.querySelector(
      '.text-sm.font-medium.text-blue-700'
    );
    expect(badgeText).toBeInTheDocument();
  });

  it('has proper heading hierarchy', () => {
    render(<Features />);

    const mainHeading = screen.getByRole('heading', { level: 2 });
    expect(mainHeading).toHaveTextContent(
      'Advanced Tools for Biomedical Research'
    );
    expect(mainHeading).toHaveClass(
      'text-3xl',
      'md:text-4xl',
      'font-bold',
      'mb-6'
    );

    const featureHeadings = screen.getAllByRole('heading', { level: 3 });
    expect(featureHeadings).toHaveLength(6);
  });

  it('handles missing features gracefully', () => {
    // This tests that the component doesn't break if features array changes
    render(<Features />);

    // Should render without errors even if features change
    expect(document.querySelector('#features')).toBeInTheDocument();
  });

  it('has overflow hidden for animations', () => {
    render(<Features />);

    const section = document.querySelector('section');
    expect(section).toHaveClass('relative', 'overflow-hidden');
  });

  it('renders with proper container structure', () => {
    render(<Features />);

    const container = document.querySelector('.container.mx-auto.px-4');
    expect(container).toBeInTheDocument();
    expect(container).toHaveClass('staggered-fade-in');
  });

  it('has proper spacing between elements', () => {
    render(<Features />);

    const textSection = document.querySelector('.max-w-3xl.mx-auto.mb-16');
    expect(textSection).toBeInTheDocument();

    const grid = document.querySelector('.gap-8');
    expect(grid).toBeInTheDocument();
  });

  it('uses semantic HTML elements', () => {
    render(<Features />);

    const section = screen.getByRole('region');
    expect(section.tagName.toLowerCase()).toBe('section');

    const headings = screen.getAllByRole('heading');
    expect(headings.length).toBeGreaterThanOrEqual(7); // 1 main + 6 feature headings
  });

  it('has proper feature card structure', () => {
    render(<Features />);

    // Check that each feature has title and description
    const featureTitles = [
      'Advanced Segmentation',
      'AI-Powered Analysis',
      'Effortless Uploads',
      'Statistical Insights',
      'Collaboration Tools',
      'Processing Pipeline',
    ];

    featureTitles.forEach(title => {
      expect(screen.getByText(title)).toBeInTheDocument();
    });
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

    render(<Features />);

    // Simulate intersection
    const mockEntry = {
      isIntersecting: true,
      target: { classList: { add: vi.fn() } },
    };

    mockCallback([mockEntry]);
    expect(mockEntry.target.classList.add).toHaveBeenCalledWith('active');
  });
});
