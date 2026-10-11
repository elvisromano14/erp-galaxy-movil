/** `a < b` para versiones `x.y.z` (los sufijos `-beta` se ignoran). Mismo criterio que el servidor (426 UPGRADE_REQUIRED). */
export function versionLt(a: string, b: string): boolean {
  const n = (v: string) => v.split('-')[0].split('.').map((x) => parseInt(x, 10) || 0);
  const [x, y] = [n(a), n(b)];
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  return false;
}
