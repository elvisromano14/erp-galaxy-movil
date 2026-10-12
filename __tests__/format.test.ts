import { caracasToday, formatMoney, formatNumber, formatQty, timeAgo } from '../src/core/format';

describe('formato', () => {
  it('números venezolanos: miles con punto, decimales con coma', () => {
    expect(formatNumber('1234567.5', 2)).toBe('1.234.567,50');
    expect(formatNumber('-1234.567', 2)).toBe('-1.234,57');
    expect(formatNumber('0', 2)).toBe('0,00');
    expect(formatNumber('999', 0)).toBe('999');
  });
  it('dinero con símbolo y decimales de la moneda', () => {
    expect(formatMoney('1250', { symbol: '$', decimals: 2 })).toBe('$ 1.250,00');
    expect(formatMoney('36.52', { symbol: 'Bs', decimals: 2 })).toBe('Bs 36,52');
    expect(formatMoney('5', null)).toBe('5,00');
  });
  it('cantidades sin ceros sobrantes', () => {
    expect(formatQty('10.0000')).toBe('10'); expect(formatQty('2.5000')).toBe('2,5'); expect(formatQty('1000.2500')).toBe('1.000,25'); expect(formatQty('0')).toBe('0');
  });
  it('antigüedad en español', () => {
    const now = Date.UTC(2026, 9, 11, 12, 0, 0);
    expect(timeAgo(new Date(now - 20_000).toISOString(), now)).toBe('hace instantes');
    expect(timeAgo(new Date(now - 5 * 60_000).toISOString(), now)).toBe('hace 5 min');
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('hace 3 h');
    expect(timeAgo(new Date(now - 86_400_000).toISOString(), now)).toBe('hace 1 día');
    expect(timeAgo(new Date(now - 3 * 86_400_000).toISOString(), now)).toBe('hace 3 días');
    expect(timeAgo(null, now)).toBe('sin datos');
  });
  it('«hoy» se calcula en hora de Caracas (UTC−4)', () => {
    expect(caracasToday(new Date('2026-10-12T02:30:00Z'))).toBe('2026-10-11'); // 22:30 del 11 en Caracas
    expect(caracasToday(new Date('2026-10-12T05:00:00Z'))).toBe('2026-10-12');
  });
});
