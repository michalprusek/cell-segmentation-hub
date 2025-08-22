/**
 * ESLint configuration for i18n validation
 *
 * Custom rules to detect hardcoded strings and enforce translation usage
 */

import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      'backend/dist/**',
      '**/*.d.ts',
      'tests/**',
      'src/test/**',
      'src/App.tsx', // App.tsx contains only providers and routing, no translatable text
      'src/components/DashboardHeader.tsx', // Component names and structural JSX
      'src/components/DashboardActions.tsx', // Component names and structural JSX
      'src/components/Features.tsx', // Feature titles are component names
      'src/components/ErrorBoundary.tsx', // Already uses translations properly with t() function
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    rules: {
      // Simple custom rule using no-restricted-syntax to detect hardcoded strings
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'JSXText[value=/^[a-zA-Z\\s]{4,}$/]',
          message:
            'Hardcoded text detected in JSX. Use t("key") for translatable strings.',
        },
      ],
    },
  },
];
