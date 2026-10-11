/**
 * Integración contra el ERP real: entorno Node puro (sin los mocks de React Native, que reemplazan `fetch`).
 * Solo carga código sin dependencias nativas (cliente de API, sesión, repositorios SQLite con better-sqlite3).
 * @type {import('jest').Config}
 */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/__tests__/integration/**/*.test.ts'],
  transform: { '^.+\\.(ts|tsx)$': ['babel-jest', { presets: ['babel-preset-expo'] }] },
};
