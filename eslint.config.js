import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    // .claude/ holds session worktrees (sibling checkouts with their own
    // tooling); linting into them breaks this repo's lint on their files.
    ignores: ['build/**', 'node_modules/**', 'assets/**', 'icons/**', '.claude/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.serviceworker,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-undef': 'error',
      'no-console': 'off',
      // Intentional swallow blocks are common in this codebase; treat only
      // non-catch empty blocks as errors.
      'no-empty': ['error', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
    },
  },
  {
    files: ['**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  prettier,
];
