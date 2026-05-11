import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';

/** @type {import('eslint').Linter.Config[]} */
export default [
  // Global ignores
  {
    ignores: ['**/dist/**', '**/node_modules/**', 'legacy/**', '**/coverage/**'],
  },

  // Base JS rules
  js.configs.recommended,

  // TypeScript files
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        // Node globals
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // Chrome extension globals
        chrome: 'readonly',
        // Service worker globals
        self: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      import: importPlugin,
    },
    rules: {
      // TypeScript
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],

      // No console.log in committed code
      'no-console': 'warn',

      // Enforce workspace alias imports, block relative cross-package paths
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../packages/*', '../../../packages/*'],
              message:
                'Use workspace alias (e.g. @polychrome/protocol) instead of relative cross-package imports.',
            },
          ],
        },
      ],

      // Import order
      'import/order': [
        'warn',
        {
          groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
          alphabetize: { order: 'asc', caseInsensitive: true },
        },
      ],

      // Disable base rule to avoid conflicts
      'no-unused-vars': 'off',
      'no-undef': 'off',
    },
  },

  // CJS config files
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        process: 'readonly',
      },
    },
  },
];
