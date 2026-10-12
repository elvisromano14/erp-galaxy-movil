import { eq } from 'drizzle-orm';
import { META, getMeta } from '../meta';
import { appSettings } from '../schema';
import type { AppDb } from '../types';

export interface AppSettings {
  company: { id: string; rif: string; legalName: string; tradeName: string | null; baseCurrencyId: string; valuationCurrencyId: string } | null;
  seller: { id: string; code: string; name: string } | null;
  sellerScope: 'ALL' | 'OWN';
  defaultWarehouseId: string | null;
  allowPriceEdit: boolean;
  maxDiscountPct: number;
  allowCustomerCreate: boolean;
  deviceCode: string;
}

/** Ajustes y políticas del vendedor (de `app_settings`, descargados con el catálogo). Sin descarga: valores restrictivos. */
export function getAppSettings(db: AppDb): AppSettings {
  const raw = db.select().from(appSettings).where(eq(appSettings.id, 1)).get();
  const j = raw ? (JSON.parse(raw.json) as Record<string, any>) : {};
  return {
    company: j.company ?? null, seller: j.seller ?? null, sellerScope: j.sellerScope ?? 'OWN', defaultWarehouseId: j.defaultWarehouseId ?? null,
    allowPriceEdit: !!j.allowPriceEdit, maxDiscountPct: Number(j.maxDiscountPct ?? 0), allowCustomerCreate: !!j.allowCustomerCreate,
    deviceCode: getMeta(db, META.deviceCode) ?? 'D00',
  };
}
