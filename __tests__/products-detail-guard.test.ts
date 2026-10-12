import { drizzle } from 'drizzle-orm/expo-sqlite';
import { getProductDetail } from '../src/db/repositories/products';

test('getProductDetail sin id no toca SQLite (drizzle omitiría el parámetro y el SQL quedaría incompleto)', () => {
  const prepareSync = jest.fn();
  const db = drizzle({ prepareSync } as never);
  expect(getProductDetail(db as never, undefined, '2026-01-01')).toBeNull();
  expect(getProductDetail(db as never, '', '2026-01-01')).toBeNull();
  expect(prepareSync).not.toHaveBeenCalled();
});
