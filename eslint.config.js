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
