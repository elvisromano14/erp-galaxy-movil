const MAP: Record<string, string> = {
  á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a', é: 'e', è: 'e', ë: 'e', ê: 'e', í: 'i', ì: 'i', ï: 'i', î: 'i',
  ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o', ú: 'u', ù: 'u', ü: 'u', û: 'u', ñ: 'n', ç: 'c',
};

/** Texto de búsqueda: minúsculas, sin tildes (sin depender de `normalize`/`Intl` de Hermes) y con espacios colapsados. */
export function normalizeText(...parts: (string | null | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p)
    .join(' ')
    .toLowerCase()
    .replace(/[áàäâãéèëêíìïîóòöôõúùüûñç]/g, (c) => MAP[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim();
}
