import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  js.configs.recommended,
  {
    files: ['*.js', '**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        NodeJS: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
    },
  },
  {
    files: [
      'src/**/*.ts',
      'prisma/**/*.ts',
      '!node_modules/**',
      '!*.js',
      '!**/*.config.js',
      '!**/*.setup.js',
    ],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: './tsconfig.json',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        NodeJS: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs.strict.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-inferrable-types': 'error',

      '@typescript-eslint/no-var-requires': 'error',
      '@typescript-eslint/ban-ts-comment': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      'no-console': 'error',
      'no-debugger': 'error',
      'no-alert': 'error',
      'prefer-const': 'error',
      'no-var': 'error',
      // `{ null: 'ignore' }` matches the frontend config (eslint.config.js at
      // the repo root). Every one of the 36 `eqeqeq` violations this rule
      // reported in backend/src was `x == null` / `x != null` — the deliberate
      // nullish idiom, which is NOT equivalent to `=== null`: it matches
      // `undefined` too. Mechanically "fixing" them would have been a silent
      // behaviour change, and several are load-bearing (`frameIndex == null`
      // must treat frame 0 as present, which is exactly why the code does not
      // write `!frameIndex`). Baselining them instead would have left 36
      // entries inviting precisely that wrong fix. Loose comparison against
      // anything other than the `null` literal is still an error.
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      curly: 'error',
      // `no-undef` (from js.configs.recommended) does not understand TypeScript
      // declaration space: it reported `Express.Multer.File` — a global
      // namespace type contributed by @types/express-serve-static-core — as an
      // undefined variable in 4 places. typescript-eslint's own guidance is to
      // disable it on typed code, because tsc already reports undefined names
      // and does so without false positives. The `globals` map above is kept:
      // `no-global-assign` (also from js.configs.recommended) still reads it.
      'no-undef': 'off',
    },
  },
  {
    files: [
      'src/**/*.test.ts',
      'src/**/__tests__/**/*.ts',
      'src/**/test/**/*.ts',
    ],
    languageOptions: {
      globals: {
        // Jest globals are now imported from @jest/globals, so we don't need them as globals anymore
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        NodeJS: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-undef': 'off', // TypeScript handles this
    },
  },
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      '**/__tests__/**',
      '**/*.test.ts',
      '*.config.js',
      'jest.*.js',
    ],
  },
];
