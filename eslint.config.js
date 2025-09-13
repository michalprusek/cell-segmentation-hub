import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist',
      '**/dist/**',
      '**/*.d.ts',
      'characteristic_functions.py',
      // Migrated from .eslintignore
      'src/types/globals.d.ts',
      'build/',
      'node_modules/',
      '*.generated.ts',
      '*.d.ts.map',
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
      // Stricter TypeScript rules
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': [
        'error',
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
      // Prevent console.log in production
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'debug'] }],
      // Prevent debugger statements
      'no-debugger': 'error',
      // Require === instead of ==
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Prevent var usage
      'no-var': 'error',
      // Prefer const
      'prefer-const': 'error',
      // No duplicate imports
      'no-duplicate-imports': 'error',
    },
  },
  // Disable Fast Refresh warnings for test files
  {
    files: [
      '**/test/**/*.{ts,tsx}',
      '**/test-utils/**/*.{ts,tsx}',
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
    ],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  }
);
