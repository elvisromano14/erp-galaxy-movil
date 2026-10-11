import { calcDocument, formatRif, isValidRif } from '../src/vendor/erp-domain';

/** Los mismos casos que calcula el servidor: la app y la API deben dar idénticos totales (plan §16, riesgo 8). */
describe('dominio compartido con el ERP', () => {
  it('totales con descuento e IVA 16 %', () => {
    const t = calcDocument([
      { quantity: '2', unitPrice: '20', discountPct: '5', taxRate: '16' },
      { quantity: '3', unitPrice: '10', taxRate: '16' },
    ]);
    expect(t.subtotal.toString()).toBe('68');
    expect(t.taxTotal.toString()).toBe('10.88');
    expect(t.total.toString()).toBe('78.88');
  });

  it('exentos aparte de la base imponible', () => {
    const t = calcDocument([{ quantity: '1', unitPrice: '100', taxRate: '16' }, { quantity: '1', unitPrice: '50', taxRate: '0', taxExempt: true }]);
    expect(t.exemptBase.toString()).toBe('50'); expect(t.taxableBase.toString()).toBe('100'); expect(t.total.toString()).toBe('166');
  });

  it('RIF venezolano con dígito verificador', () => {
    expect(isValidRif('V-19322174-9')).toBe(true);
    expect(isValidRif('V-19322174-1')).toBe(false);
    expect(formatRif('v193221749')).toBe('V-19322174-9');
  });
});
