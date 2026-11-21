// ESLint flat config (v9+)
const globals = require('globals');

module.exports = [
  {
    ignores: [
      'extension/libs/**',
      'extension/dist/**',
    ],
  },
  {
    files: ['.copilot/hooks/*.cjs', '.claude/hooks/*.cjs', 'tests/audit-hooks.test.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: globals.node,
    },
    rules: {
      'no-unused-vars': 'error',
      'no-undef': 'error',
      semi: ['error', 'always'],
    },
  },
  {
    files: ['extension/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error',
      semi: ['error', 'always'],
    },
  },
];
