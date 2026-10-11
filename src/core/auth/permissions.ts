/** Permisos de la sesión (`modulo:recurso:accion`); `*` = administrador global. El servidor siempre valida: esto solo gobierna la UI. */
export const hasPermission = (permissions: readonly string[], code: string) => permissions.includes('*') || permissions.includes(code);

export const hasAny = (permissions: readonly string[], codes: readonly string[]) => codes.some((c) => hasPermission(permissions, c));
