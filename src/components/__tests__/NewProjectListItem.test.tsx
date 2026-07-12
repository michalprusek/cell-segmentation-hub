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

  it('renders the translated "create project" title as an h3 heading', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveTextContent(/create.*project/i);
  });

  it('renders the plus icon', () => {
    render(<NewProjectListItem onClick={mockOnClick} />);

    expect(document.querySelector('svg')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    render(<NewProjectListItem onClick={mockOnClick} />);

    const card = document.querySelector('.cursor-pointer') as HTMLElement;
    await user.click(card);
    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it('fires onClick once per click across rapid clicks', async () => {
    const user = userEvent.setup();
    render(<NewProjectListItem onClick={mockOnClick} />);

    const card = document.querySelector('.cursor-pointer') as HTMLElement;
    await user.click(card);
    await user.click(card);
    await user.click(card);
    expect(mockOnClick).toHaveBeenCalledTimes(3);
  });
});
