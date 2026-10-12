#!/usr/bin/env node
/**
 * Firma de release: parchea `android/app/build.gradle` (generado por `expo prebuild`) para firmar el build `release` con el keystore
 * propio que indican las variables de entorno (en lugar de la clave de depuración):
 *   ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS, ANDROID_KEY_PASSWORD
 * Uso: node scripts/release-signing.cjs android/app/build.gradle
 */
const fs = require('node:fs');

const RELEASE_BLOCK = `
        release {
            storeFile file(System.getenv('ANDROID_KEYSTORE_PATH') ?: 'release.keystore')
            storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
            keyAlias System.getenv('ANDROID_KEY_ALIAS')
            keyPassword System.getenv('ANDROID_KEY_PASSWORD')
        }`;

function patchGradle(text) {
  if (text.includes("System.getenv('ANDROID_KEYSTORE_PATH')")) return text; // ya parcheado
  const signing = /(signingConfigs\s*\{\s*debug\s*\{[^}]*\})/;
  if (!signing.test(text)) throw new Error('No se encontró el bloque signingConfigs.debug en build.gradle');
  const withRelease = text.replace(signing, `$1${RELEASE_BLOCK}`);
  // el build `release` deja de usar la clave de depuración
  const relBuild = /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;
  if (!relBuild.test(withRelease)) throw new Error('No se encontró signingConfig en buildTypes.release');
  return withRelease.replace(relBuild, '$1signingConfig signingConfigs.release');
}

module.exports = { patchGradle };

if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error('Uso: node scripts/release-signing.cjs <build.gradle>'); process.exit(2); }
  for (const v of ['ANDROID_KEYSTORE_PATH', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD']) {
    if (!process.env[v]) { console.error(`Falta la variable ${v}`); process.exit(1); }
  }
  fs.writeFileSync(file, patchGradle(fs.readFileSync(file, 'utf8')));
  console.log(`Firma de release aplicada a ${file}`);
}
