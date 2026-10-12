import { createStore } from 'zustand/vanilla';

/** Resultado de una pantalla selectora (cliente / producto) que el editor recoge al volver al primer plano. */
interface PickerState { kind: 'customer' | 'product' | null; value: string | null }
export const pickerStore = createStore<PickerState>(() => ({ kind: null, value: null }));

export const pick = (kind: 'customer' | 'product', value: string) => pickerStore.setState({ kind, value });

/** Devuelve (y limpia) lo elegido del tipo pedido. */
export function consumePick(kind: 'customer' | 'product'): string | null {
  const s = pickerStore.getState();
  if (s.kind !== kind || !s.value) return null;
  pickerStore.setState({ kind: null, value: null });
  return s.value;
}
