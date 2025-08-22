import React, { createContext, useContext, useState, useEffect } from 'react';
import apiClient from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { getErrorMessage } from '@/types';
import { logger } from '@/lib/logger';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  setTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const { user } = useAuth();
  const [theme, setThemeState] = useState<Theme>('system');
  const [loaded, setLoaded] = useState(false);

  // Načtení motivu z localStorage nebo z databáze
  useEffect(() => {
    const fetchUserTheme = async () => {
      // První zkusíme načíst z localStorage
      const localTheme = localStorage.getItem('theme') as Theme | null;

      // Pokud jsme přihlášeni, zkusíme získat motiv z profilu
      if (user) {
        try {
          const profileData = await apiClient.getUserProfile();

          if (profileData && profileData.preferred_theme) {
            const dbTheme = profileData.preferred_theme as Theme;
            setThemeState(dbTheme);
            localStorage.setItem('theme', dbTheme);
            applyTheme(dbTheme);
            setLoaded(true);
            return;
          }
        } catch (error: unknown) {
          logger.error('Error loading theme preference:', error);
          const errorMessage = getErrorMessage(error) || 'Failed to load theme';
          logger.error('Theme load error:', errorMessage);
        }
      }

      // Pokud nemáme motiv z profilu, použijeme localStorage nebo výchozí hodnotu
      if (localTheme) {
        setThemeState(localTheme);
        applyTheme(localTheme);
      } else {
        setThemeState('system');
        applyTheme('system');
      }

      setLoaded(true);
    };

    fetchUserTheme();
  }, [user]);

  const setTheme = async (newTheme: Theme) => {
    localStorage.setItem('theme', newTheme);
    setThemeState(newTheme);
    applyTheme(newTheme);

    // Uložení do databáze, pokud jsme přihlášeni
    if (user) {
      try {
        await apiClient.updateUserProfile({ preferred_theme: newTheme });
      } catch (error: unknown) {
        logger.error('Error updating profile:', error);
        const errorMessage = getErrorMessage(error) || 'Failed to save theme';
        logger.error('Theme save error:', errorMessage);
      }
    }
  };

  const applyTheme = (theme: Theme) => {
    const root = window.document.documentElement;

    if (theme === 'system') {
      const systemTheme =
        typeof window !== 'undefined' && window.matchMedia
          ? window.matchMedia('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light'
          : 'light';

      root.classList.remove('light', 'dark');
      root.classList.add(systemTheme);

      // Set data-theme attribute for components that use it
      root.setAttribute('data-theme', systemTheme);
    } else {
      root.classList.remove('light', 'dark');
      root.classList.add(theme);

      // Set data-theme attribute for components that use it
      root.setAttribute('data-theme', theme);
    }

    // Apply consistent dark mode styling to body and html
    if (root.classList.contains('dark')) {
      document.documentElement.style.backgroundColor = '#111827'; // bg-gray-900
      document.body.style.backgroundColor = '#111827'; // bg-gray-900
      document.body.classList.add('dark');
      document.body.classList.remove('light');
    } else {
      document.documentElement.style.backgroundColor = '#f9fafb'; // bg-gray-50
      document.body.style.backgroundColor = '#f9fafb'; // bg-gray-50
      document.body.classList.add('light');
      document.body.classList.remove('dark');
    }
  };

  // Initial theme application
  useEffect(() => {
    if (!loaded) return;

    applyTheme(theme);

    // Listen for system theme changes if using system theme
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

      const handleChange = () => {
        applyTheme('system');
      };

      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme, loaded]);

  if (!loaded) {
    return null; // Nezobrazovat nic, dokud nemáme načtený motiv
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
