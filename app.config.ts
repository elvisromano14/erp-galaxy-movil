import type { ExpoConfig } from 'expo/config';

/**
 * Variantes por entorno (APP_ENV = dev | staging | prod): permiten instalar las tres versiones en el mismo teléfono.
 * API_URL se puede sobrescribir por variable de entorno al compilar.
 */
const env = (process.env.APP_ENV ?? 'dev') as 'dev' | 'staging' | 'prod';
const suffix = env === 'prod' ? '' : `.${env}`;
// Cifrado de la base con SQLCipher: se activa con SQLCIPHER=1 al compilar (validar en un teléfono real antes de usarlo en producción).
const sqlcipher = process.env.SQLCIPHER === '1';

const API_URLS: Record<typeof env, string> = {
  dev: 'http://10.0.2.2:3101', // emulador Android → API local del ERP
  staging: 'https://staging.invalid',
  prod: 'https://prod-cloud.tailf30e87.ts.net:10000',
};

export default (): ExpoConfig => ({
  name: env === 'prod' ? 'ERP Ventas' : `ERP Ventas (${env})`,
  slug: 'erp-galaxy-movil',
  scheme: 'erpventas',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'automatic',
  android: {
    package: `com.galaxy.erpventas${suffix}`,
    // Número de versión para Play: el CI lo fija con VERSION_CODE (debe crecer en cada publicación).
    versionCode: Number(process.env.VERSION_CODE ?? 1),
    allowBackup: false, // sin copias de seguridad de Android (datos del cliente en el teléfono)
    permissions: ['CAMERA'],
    adaptiveIcon: {
      backgroundColor: '#E6F4FE',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-sqlite', { useSQLCipher: sqlcipher }],
    ['expo-local-authentication', { faceIDPermission: false }],
    ['expo-camera', { cameraPermission: 'Se usa la cámara para escanear códigos de barras de productos.' }],
    'expo-sharing',
  ],
  extra: { appEnv: env, apiUrl: process.env.API_URL ?? API_URLS[env], sqlcipher },
});
