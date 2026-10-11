const { defineConfig } = require('eslint/config');
const expo = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expo,
  { ignores: ['dist/*', 'src/vendor/*', 'src/db/migrations/*', '.expo/*', 'node_modules/*'] },
]);
