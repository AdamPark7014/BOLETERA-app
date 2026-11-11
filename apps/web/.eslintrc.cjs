/**
 * ESLint de la web del comprador. El script apuntaba a `src/`, que no existe,
 * y no había configuración. Reglas recomendadas de TypeScript, ganchos de React
 * y las de Next que el código ya cita en sus comentarios de desactivación.
 */
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  parserOptions: { sourceType: 'module', ecmaVersion: 2022, ecmaFeatures: { jsx: true } },
  plugins: ['@typescript-eslint', 'react-hooks', '@next/next'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  env: { browser: true, node: true, es2022: true },
  ignorePatterns: ['.next/', 'node_modules/', 'public/', 'next-env.d.ts'],
  rules: {
    // Temporizadores declarados antes y asignados una vez, leídos en la limpieza.
    'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
    '@next/next/no-img-element': 'warn',
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
    ],
  },
};
