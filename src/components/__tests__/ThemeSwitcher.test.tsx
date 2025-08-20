import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import ThemeSwitcher from '@/components/ThemeSwitcher';

// Mock theme context
const mockThemeContext = {
  theme: 'light' as const,
  setTheme: vi.fn(),
};

vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: () => mockThemeContext,
  Theme: {
    LIGHT: 'light',
    DARK: 'dark',
    SYSTEM: 'system',
  },
}));

describe('ThemeSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockThemeContext.theme = 'light';
    mockThemeContext.setTheme = vi.fn().mockResolvedValue(undefined);
  });

  it('renders theme switcher button', () => {
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-label');
  });

  it('displays correct icon for light theme', () => {
    mockThemeContext.theme = 'light';
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    const icon = button.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('displays correct icon for dark theme', () => {
    mockThemeContext.theme = 'dark';
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    const icon = button.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('displays correct icon for system theme', () => {
    mockThemeContext.theme = 'system';
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    const icon = button.querySelector('svg');
    expect(icon).toBeInTheDocument();
  });

  it('opens dropdown menu when clicked', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    // Wait for dropdown to appear
    await waitFor(() => {
      expect(screen.getByText('Light')).toBeInTheDocument();
      expect(screen.getByText('Dark')).toBeInTheDocument();
      expect(screen.getByText('System')).toBeInTheDocument();
    });
  });

  it('displays all theme options in dropdown', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      const lightOption = screen.getByText('Light');
      const darkOption = screen.getByText('Dark');
      const systemOption = screen.getByText('System');

      expect(lightOption).toBeInTheDocument();
      expect(darkOption).toBeInTheDocument();
      expect(systemOption).toBeInTheDocument();
    });
  });

  it('shows check mark for currently selected theme', async () => {
    mockThemeContext.theme = 'light';
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      // Check icon should be present for light theme
      const lightOption = screen
        .getByText('Light')
        .closest('[role="menuitem"]');
      expect(lightOption).toBeInTheDocument();

      // Look for check icon in the light option
      const checkIcon = lightOption?.querySelector(
        'svg[class*="h-4"][class*="w-4"][class*="text-blue-600"]'
      );
      expect(checkIcon).toBeInTheDocument();
    });
  });

  it('calls setTheme when different option is selected', async () => {
    mockThemeContext.theme = 'light';
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      const darkOption = screen.getByText('Dark');
      expect(darkOption).toBeInTheDocument();
    });

    const darkOption = screen.getByText('Dark');
    await user.click(darkOption);

    expect(mockThemeContext.setTheme).toHaveBeenCalledWith('dark');
  });

  it('calls setTheme for system option', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      const systemOption = screen.getByText('System');
      expect(systemOption).toBeInTheDocument();
    });

    const systemOption = screen.getByText('System');
    await user.click(systemOption);

    expect(mockThemeContext.setTheme).toHaveBeenCalledWith('system');
  });

  it('has proper button styling', () => {
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    expect(button).toHaveClass(
      'text-gray-700',
      'hover:text-blue-500',
      'hover:bg-gray-100/50',
      'transition-colors'
    );
  });

  it('has proper dropdown alignment', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      const dropdown = document.querySelector('[role="menu"]');
      expect(dropdown).toBeInTheDocument();
      expect(dropdown).toHaveClass('w-[140px]');
    });
  });

  it('renders icons for each theme option', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      const menuItems = screen.getAllByRole('menuitem');
      expect(menuItems).toHaveLength(3);

      menuItems.forEach(item => {
        const icon = item.querySelector('svg');
        expect(icon).toBeInTheDocument();
        expect(icon).toHaveClass('h-4', 'w-4');
      });
    });
  });

  it('handles theme change with async setTheme', async () => {
    const asyncSetTheme = vi
      .fn()
      .mockImplementation(
        () => new Promise(resolve => setTimeout(resolve, 50))
      );
    mockThemeContext.setTheme = asyncSetTheme;

    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    const darkOption = screen.getByText('Dark');
    await user.click(darkOption);

    await waitFor(() => {
      expect(asyncSetTheme).toHaveBeenCalledWith('dark');
    });
  });

  it('closes dropdown after selection', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    const darkOption = screen.getByText('Dark');
    await user.click(darkOption);

    // Dropdown should close after selection
    await waitFor(() => {
      expect(screen.queryByText('Dark')).not.toBeInTheDocument();
    });
  });

  it('supports keyboard navigation', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');

    // Focus button and open with Enter
    button.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Light')).toBeInTheDocument();
    });

    // Navigate with arrow keys
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(mockThemeContext.setTheme).toHaveBeenCalled();
  });

  it('closes dropdown on Escape key', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText('Light')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByText('Light')).not.toBeInTheDocument();
    });
  });

  it('has proper aria-label for accessibility', () => {
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-label');
  });

  it('handles unknown theme gracefully', () => {
    // @ts-expect-error - Testing edge case
    mockThemeContext.theme = 'unknown';
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    const icon = button.querySelector('svg');
    expect(icon).toBeInTheDocument();
    // Should default to system icon
  });

  it('maintains state across theme changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ThemeSwitcher />);

    // Start with light theme
    mockThemeContext.theme = 'light';
    rerender(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    const darkOption = screen.getByText('Dark');
    await user.click(darkOption);

    // Theme changes to dark
    mockThemeContext.theme = 'dark';
    rerender(<ThemeSwitcher />);

    await user.click(button);
    await waitFor(() => {
      const darkOptionAgain = screen
        .getByText('Dark')
        .closest('[role="menuitem"]');
      const checkIcon = darkOptionAgain?.querySelector(
        'svg[class*="text-blue-600"]'
      );
      expect(checkIcon).toBeInTheDocument();
    });
  });

  it('has proper menu item structure', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    await waitFor(() => {
      const menuItems = screen.getAllByRole('menuitem');

      menuItems.forEach(item => {
        expect(item).toHaveClass(
          'flex',
          'items-center',
          'justify-between',
          'cursor-pointer'
        );

        // Each item should have icon and text
        const iconAndText = item.querySelector('.flex.items-center.gap-2');
        expect(iconAndText).toBeInTheDocument();
      });
    });
  });

  it('handles setTheme errors gracefully', async () => {
    const failingSetTheme = vi
      .fn()
      .mockRejectedValue(new Error('Theme change failed'));
    mockThemeContext.setTheme = failingSetTheme;

    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    await user.click(button);

    const darkOption = screen.getByText('Dark');
    await user.click(darkOption);

    await waitFor(() => {
      expect(failingSetTheme).toHaveBeenCalledWith('dark');
    });

    // Component should not break on error
    expect(button).toBeInTheDocument();
  });

  it('supports rapid theme switching', async () => {
    const user = userEvent.setup();
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');

    // Rapidly switch themes
    await user.click(button);
    await user.click(screen.getByText('Dark'));

    expect(mockThemeContext.setTheme).toHaveBeenLastCalledWith('dark');

    await user.click(button);
    await user.click(screen.getByText('System'));

    expect(mockThemeContext.setTheme).toHaveBeenLastCalledWith('system');

    expect(mockThemeContext.setTheme).toHaveBeenCalledTimes(2);
  });

  it('renders with proper button size', () => {
    render(<ThemeSwitcher />);

    const button = screen.getByRole('button');
    const icon = button.querySelector('svg');

    expect(icon).toHaveClass('h-4', 'w-4');
  });
});
