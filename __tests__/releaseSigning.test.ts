import fs from 'node:fs';
import path from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { patchGradle } = require('../scripts/release-signing.cjs') as { patchGradle: (t: string) => string };

const GRADLE = `
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            signingConfig signingConfigs.debug
            minifyEnabled true
        }
    }`;

describe('firma de release', () => {
  it('agrega la firma release con variables de entorno y deja la de depuración para el build debug', () => {
    const out = patchGradle(GRADLE);
    expect(out).toContain("storeFile file(System.getenv('ANDROID_KEYSTORE_PATH')");
    expect(out).toContain("keyAlias System.getenv('ANDROID_KEY_ALIAS')");
    expect(out).toMatch(/release \{[\s\S]*signingConfig signingConfigs\.release/);
    expect(out).toMatch(/debug \{\s*signingConfig signingConfigs\.debug/); // el debug conserva la suya
    expect(out).not.toMatch(/release \{[^}]*signingConfig signingConfigs\.debug[^}]*minifyEnabled/);
  });
  it('es idempotente y falla con claridad si el archivo no tiene el formato esperado', () => {
    const once = patchGradle(GRADLE);
    expect(patchGradle(once)).toBe(once);
    expect(() => patchGradle('apply plugin: "com.android.application"')).toThrow(/signingConfigs\.debug/);
  });
  it('funciona con el build.gradle real que genera expo prebuild (si existe en este equipo)', () => {
    const real = path.join(__dirname, '..', 'android', 'app', 'build.gradle');
    if (!fs.existsSync(real)) return;
    const out = patchGradle(fs.readFileSync(real, 'utf8'));
    expect(out).toContain('signingConfig signingConfigs.release'); expect(out).toContain('ANDROID_KEYSTORE_PASSWORD');
  });
});
