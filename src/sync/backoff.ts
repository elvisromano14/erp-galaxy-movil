/** Espera antes de reintentar: 5 s, 15 s, 1 min, 5 min, 15 min… hasta 30 min, con *jitter* (±20 %). */
const STEPS_MS = [5_000, 15_000, 60_000, 300_000, 900_000, 1_800_000];

export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const base = STEPS_MS[Math.min(Math.max(attempts, 1), STEPS_MS.length) - 1];
  return Math.round(base * (0.8 + random() * 0.4));
}

export function nextAttemptAt(attempts: number, now = Date.now(), random: () => number = Math.random): string {
  return new Date(now + backoffMs(attempts, random)).toISOString();
}
