/** Políticas de seguridad y operación fuera de línea (plan §11). */
export const POLICY = {
  /** Días sin sincronizar tras los cuales se exige conexión e inicio de sesión (los datos y la cola se conservan). */
  maxOfflineDays: 14,
  /** Días que se conserva la cola de un dispositivo REVOCADO antes de borrarla (para que administración pueda rehabilitarlo o recuperar datos). */
  revokedOutboxRetentionDays: 7,
  /** Inactividad en segundo plano tras la cual se pide el PIN. */
  lockTimeoutMs: 5 * 60_000,
  /** Intervalo mínimo de la tarea en segundo plano (minutos; Android lo respeta como mínimo). */
  backgroundIntervalMinutes: 15,
} as const;

export const DAY_MS = 86_400_000;
