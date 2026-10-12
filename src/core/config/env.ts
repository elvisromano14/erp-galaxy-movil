import Constants from 'expo-constants';

export interface AppEnv { appEnv: 'dev' | 'staging' | 'prod'; apiUrl: string; appVersion: string; sqlcipher: boolean }

/** Configuración de compilación (app.config.ts → extra). */
export function readEnv(): AppEnv {
  const extra = (Constants.expoConfig?.extra ?? {}) as { appEnv?: AppEnv['appEnv']; apiUrl?: string; sqlcipher?: boolean };
  return { appEnv: extra.appEnv ?? 'dev', apiUrl: extra.apiUrl ?? 'http://10.0.2.2:3101', appVersion: Constants.expoConfig?.version ?? '0.0.0', sqlcipher: !!extra.sqlcipher };
}
