import { useStore } from 'zustand';
import { hasAny, hasPermission } from '../auth/permissions';
import { session } from '../services';
import type { SessionState } from './SessionService';

/** Selector reactivo del estado de sesión: `const status = useSession((s) => s.status)`. */
export function useSession<T>(selector: (s: SessionState) => T): T {
  return useStore(session.store, selector);
}

/** ¿Tiene el usuario este permiso? (solo gobierna la UI; el servidor siempre valida). */
export function usePermission(code: string): boolean {
  return useSession((s) => hasPermission(s.permissions, code));
}

export function useAnyPermission(...codes: string[]): boolean {
  return useSession((s) => hasAny(s.permissions, codes));
}

/** ¿Tiene TODOS estos permisos? (p. ej. crear y confirmar pedidos). */
export function useAllPermissions(...codes: string[]): boolean {
  return useSession((s) => codes.every((c) => hasPermission(s.permissions, c)));
}
