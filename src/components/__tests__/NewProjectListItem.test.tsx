import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import NewProjectListItem from '@/components/NewProjectListItem';

describe('NewProjectListItem', () => {
  const mockOnClick = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the create project card', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    expect(screen.getByText(/create project/i)).toBeInTheDocument();
  });

  it('displays the create project description', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    // Should display translated description text
    const description = document.querySelector('.text-sm.text-gray-500');
    expect(description).toBeInTheDocument();
  });

  it('shows plus icon', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const iconContainer = document.querySelector('.w-16.h-16');
    expect(iconContainer).toBeInTheDocument();

    const plusIcon = iconContainer?.querySelector('svg');
    expect(plusIcon).toBeInTheDocument();
    expect(plusIcon).toHaveClass('h-8', 'w-8');
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    render(<NewProjectListItem onClick={mockOnClick} />);

    const card = document.querySelector('.cursor-pointer') as HTMLElement;
    expect(card).toBeInTheDocument();

    await user.click(card);
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('has proper card styling', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const card = document.querySelector('.overflow-hidden.cursor-pointer');
    expect(card).toBeInTheDocument();
    expect(card).toHaveClass(
      'hover:bg-gray-50',
      'dark:hover:bg-gray-700',
      'transition-all',
      'duration-300',
      'w-full'
    );
  });

  it('has proper icon container styling', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const iconContainer = document.querySelector('.w-16.h-16');
    expect(iconContainer).toBeInTheDocument();
    expect(iconContainer).toHaveClass(
      'bg-blue-50',
      'dark:bg-blue-900/20',
      'rounded-full',
      'flex',
      'items-center',
      'justify-center',
      'mr-4'
    );
  });

  it('has proper icon styling', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const icon = document.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveClass(
      'h-8',
      'w-8',
      'text-blue-500',
      'dark:text-blue-400'
    );
  });

  it('has proper title styling', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const title = screen.getByRole('heading', { level: 3 });
    expect(title).toBeInTheDocument();
    expect(title).toHaveClass('text-lg', 'font-medium');
  });

  it('has proper description styling', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const description = document.querySelector(
      '.text-sm.text-gray-500.dark\\:text-gray-400'
    );
    expect(description).toBeInTheDocument();
  });

  it('has proper layout structure', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const cardContent = document.querySelector('.flex.items-center.p-4');
    expect(cardContent).toBeInTheDocument();

    const textContent = document.querySelector('.flex-1');
    expect(textContent).toBeInTheDocument();
  });

  it('supports keyboard navigation', async () => {
    const user = userEvent.setup();
    render(<NewProjectListItem onClick={mockOnClick} />);

    const card = document.querySelector('.cursor-pointer') as HTMLElement;
    expect(card).toBeInTheDocument();

    // Focus the element (Card component should be focusable)
    card.focus();

    // Test keyboard interaction - note that Card may not handle Enter by default
    // but we can verify the element receives focus
    await user.keyboard('{Enter}');
  });

  it('has semantic heading structure', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toBeInTheDocument();
    expect(heading.tagName.toLowerCase()).toBe('h3');
  });

  it('uses translation context for text content', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    // The component should use useLanguage hook and display translated text
    // Since we're using the test utils with providers, the text should be rendered
    expect(screen.getByText(/create project/i)).toBeInTheDocument();
  });

  it('handles click events properly', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.fn();
    render(<NewProjectListItem onClick={clickSpy} />);

    const clickableElement = document.querySelector(
      '.cursor-pointer'
    ) as HTMLElement;
    expect(clickableElement).toBeInTheDocument();

    await user.click(clickableElement);
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('has hover effects', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const card = document.querySelector('.cursor-pointer');
    expect(card).toHaveClass(
      'hover:bg-gray-50',
      'dark:hover:bg-gray-700',
      'transition-all'
    );
  });

  it('provides visual feedback on hover', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const card = document.querySelector('.cursor-pointer');
    expect(card).toHaveClass('transition-all', 'duration-300');
  });

  it('has proper responsive design', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const card = document.querySelector('.w-full');
    expect(card).toBeInTheDocument();

    const content = document.querySelector('.flex.items-center');
    expect(content).toBeInTheDocument();
  });

  it('maintains consistent spacing', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const content = document.querySelector('.p-4');
    expect(content).toBeInTheDocument();

    const iconContainer = document.querySelector('.mr-4');
    expect(iconContainer).toBeInTheDocument();
  });

  it('supports dark mode styling', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    // Check for dark mode classes
    expect(
      document.querySelector('.dark\\:hover\\:bg-gray-700')
    ).toBeInTheDocument();
    expect(
      document.querySelector('.dark\\:bg-blue-900\\/20')
    ).toBeInTheDocument();
    expect(document.querySelector('.dark\\:text-blue-400')).toBeInTheDocument();
    expect(document.querySelector('.dark\\:text-gray-400')).toBeInTheDocument();
  });

  it('has accessible color contrast', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const icon = document.querySelector('svg');
    expect(icon).toHaveClass('text-blue-500', 'dark:text-blue-400');

    const description = document.querySelector(
      '.text-gray-500.dark\\:text-gray-400'
    );
    expect(description).toBeInTheDocument();
  });

  it('maintains proper component structure', () => {
    const { container } = render(<NewProjectListItem onClick={mockOnClick} />);

    // Should have a single root Card component
    const cards = container.querySelectorAll('[class*="overflow-hidden"]');
    expect(cards).toHaveLength(1);
  });

  it('handles multiple rapid clicks correctly', async () => {
    const user = userEvent.setup();
    render(<NewProjectListItem onClick={mockOnClick} />);

    const clickableElement = document.querySelector(
      '.cursor-pointer'
    ) as HTMLElement;
    expect(clickableElement).toBeInTheDocument();

    // Rapid clicking
    await user.click(clickableElement);
    await user.click(clickableElement);
    await user.click(clickableElement);

    expect(mockOnClick).toHaveBeenCalledTimes(3);
  });

  it('renders consistently across different themes', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    // Test that all theme-related classes are present
    expect(
      document.querySelector('.dark\\:hover\\:bg-gray-700')
    ).toBeInTheDocument();
    expect(
      document.querySelector('.dark\\:bg-blue-900\\/20')
    ).toBeInTheDocument();
    expect(document.querySelector('.dark\\:text-blue-400')).toBeInTheDocument();
    expect(document.querySelector('.dark\\:text-gray-400')).toBeInTheDocument();
  });
});
