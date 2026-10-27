import { useStore } from 'zustand';
import { updater } from '../../core/services';
import type { UpdateState } from './UpdateService';

/** Selector reactivo del estado de la actualización: `const phase = useUpdate((s) => s.phase)`. */
export function useUpdate<T>(selector: (s: UpdateState) => T): T {
  return useStore(updater.store, selector);
}
