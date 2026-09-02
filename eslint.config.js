import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'coverage'] },

  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // ---------------------------------------------------------------------
  // Architectural boundary: the domain layer stays pure.
  //
  // Nothing under src/domain may reach for storage, React, or the ambient
  // clock. Time and data must be passed in as arguments. This is what keeps
  // the game logic testable and lets an AI-generated ruleset be swapped in
  // later without touching the app.
  // ---------------------------------------------------------------------
  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@/data',
                '@/data/*',
                '@/services',
                '@/services/*',
                '@/state',
                '@/state/*',
                '@/components',
                '@/components/*',
                '@/routes',
                '@/routes/*',
                '../data/*',
                '../services/*',
                '../../data/*',
                '../../services/*',
              ],
              message:
                'domain/ must stay pure: no storage, services, or UI imports. Pass data in as arguments.',
            },
            {
              group: ['react', 'react-dom', 'react-router-dom', 'dexie', 'dexie-react-hooks'],
              message: 'domain/ must stay framework-free. Keep React and Dexie out of the rules.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message:
            'domain/ must not read the ambient clock. Accept an `instant: number` parameter instead.',
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message:
            'domain/ must not read the ambient clock. Accept an `instant: number` parameter instead.',
        },
      ],
    },
  },

  {
    files: ['**/*.{js,mjs}', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
    ...tseslint.configs.disableTypeChecked,
  },
)
