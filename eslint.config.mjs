import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', '.artifacts/**', 'node_modules/**'],
  },
  {
    files: ['**/*.mjs'],
    ...js.configs.recommended,
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['src/runtime/agent-service.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MethodDefinition[key.name='renderRsvpCurrentStateDeterministically'] TemplateLiteral > MemberExpression[object.name='invitation'][property.name='eventDate']",
          message: 'Use formatRsvpSpanishDate(invitation.eventDate) - direct invitation.eventDate interpolation is forbidden in deterministic renderers.',
        },
      ],
    },
  },
);
