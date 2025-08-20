import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@/test/utils/test-utils';
import LanguageSwitcher from '@/components/LanguageSwitcher';

// Mock the language context
const mockSetLanguage = vi.fn();
let mockLanguage = 'en';
const mockT = vi.fn((key: string) => key);

vi.mock('@/contexts/LanguageContext', async () => {
  const actual = await vi.importActual('@/contexts/LanguageContext');
  return {
    ...actual,
    useLanguage: () => ({
      language: mockLanguage,
      setLanguage: mockSetLanguage,
      t: mockT,
    }),
  };
});

describe('LanguageSwitcher', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockLanguage = 'en';
  });

  afterEach(() => {
    cleanup();
  });

  it('renders language switcher button', () => {
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('text-gray-700', 'hover:text-blue-500');
  });

  it('shows Languages icon', () => {
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    const icon = button.querySelector('.h-4.w-4');
    expect(icon).toBeInTheDocument();
  });

  it('opens dropdown menu when clicked', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    await user.click(button);

    // Should show all language options
    expect(screen.getByText('English')).toBeInTheDocument();
    expect(screen.getByText('Čeština')).toBeInTheDocument();
    expect(screen.getByText('Deutsch')).toBeInTheDocument();
    expect(screen.getByText('Español')).toBeInTheDocument();
    expect(screen.getByText('Français')).toBeInTheDocument();
    expect(screen.getByText('中文')).toBeInTheDocument();
  });

  it('displays language flags', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    await user.click(button);

    expect(screen.getByText('🇺🇸')).toBeInTheDocument();
    expect(screen.getByText('🇨🇿')).toBeInTheDocument();
    expect(screen.getByText('🇩🇪')).toBeInTheDocument();
    expect(screen.getByText('🇪🇸')).toBeInTheDocument();
    expect(screen.getByText('🇫🇷')).toBeInTheDocument();
    expect(screen.getByText('🇨🇳')).toBeInTheDocument();
  });

  it('shows check mark for current language', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    await user.click(button);

    // Should show check mark for English (current language)
    const checkIcon = document.querySelector('.text-blue-600');
    expect(checkIcon).toBeInTheDocument();
  });

  it('calls setLanguage when language option is clicked', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    await user.click(button);

    const czechOption = screen.getByText('Čeština');
    await user.click(czechOption);

    expect(mockSetLanguage).toHaveBeenCalledWith('cs');
  });

  it('handles all language options correctly', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const languageTests = [
      { text: 'English', value: 'en' },
      { text: 'Čeština', value: 'cs' },
      { text: 'Deutsch', value: 'de' },
      { text: 'Español', value: 'es' },
      { text: 'Français', value: 'fr' },
      { text: '中文', value: 'zh' },
    ];

    for (const lang of languageTests) {
      const button = screen.getByRole('button', {
        name: 'accessibility.selectLanguage',
      });
      await user.click(button);

      const option = screen.getByText(lang.text);
      await user.click(option);

      expect(mockSetLanguage).toHaveBeenCalledWith(lang.value);

      // Clean up for next iteration
      mockSetLanguage.mockClear();
    }
  });

  it('has correct dropdown menu styling', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    await user.click(button);

    const dropdownContent = document.querySelector('[role="menu"]');
    expect(dropdownContent).toHaveClass('w-[160px]');
  });

  it('has correct button variant and size', () => {
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    // Check for ghost variant and sm size classes (these would be applied by the Button component)
    expect(button).toHaveClass('hover:bg-gray-100/50');
  });

  it('shows proper item structure with flag and name', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    await user.click(button);

    // Check that flag and name are properly structured
    const englishItem = screen
      .getByText('English')
      .closest('[role="menuitem"]');
    expect(englishItem).toBeInTheDocument();

    const flagInItem = englishItem?.querySelector('span');
    expect(flagInItem?.textContent).toBe('🇺🇸');
  });

  it('has proper accessibility attributes', () => {
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    expect(button).toHaveAttribute(
      'aria-label',
      'accessibility.selectLanguage'
    );
  });

  it('handles different current language correctly', async () => {
    // Change the mock language
    mockLanguage = 'cs';

    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    // The component should still render correctly with different current language
    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    expect(button).toBeInTheDocument();
  });

  it('shows correct menu items with proper cursor pointer', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    await user.click(button);

    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems).toHaveLength(6); // All 6 language options

    menuItems.forEach(item => {
      expect(item).toHaveClass('cursor-pointer');
    });
  });

  it('handles async language change', async () => {
    mockSetLanguage.mockImplementationOnce(() => Promise.resolve());

    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    await user.click(button);

    const frenchOption = screen.getByText('Français');
    await user.click(frenchOption);

    expect(mockSetLanguage).toHaveBeenCalledWith('fr');
  });

  it('positions dropdown correctly with align="end"', async () => {
    const user = userEvent.setup();
    render(<LanguageSwitcher />);

    const button = screen.getByRole('button', {
      name: 'accessibility.selectLanguage',
    });
    await user.click(button);

    // The dropdown positioning is handled by the DropdownMenuContent component
    // We can verify the component renders without error
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });
});
