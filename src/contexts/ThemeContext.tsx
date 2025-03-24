
import React, { createContext, useContext, useState, useEffect } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextType {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: 'system',
  setTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(
    (localStorage.getItem('theme') as Theme) || 'system'
  );

  const setTheme = (newTheme: Theme) => {
    localStorage.setItem('theme', newTheme);
    setThemeState(newTheme);
    applyTheme(newTheme);
  };

  const applyTheme = (theme: Theme) => {
    const root = window.document.documentElement;
    
    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
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

    // Apply additional dark mode classes to ensure consistent background
    if (root.classList.contains('dark')) {
      document.body.classList.add('bg-gray-900', 'text-white');
      document.body.classList.remove('bg-gray-50', 'text-gray-900');
    } else {
      document.body.classList.add('bg-gray-50', 'text-gray-900');
      document.body.classList.remove('bg-gray-900', 'text-white');
    }
  };

  // Initial theme application
  useEffect(() => {
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
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};
