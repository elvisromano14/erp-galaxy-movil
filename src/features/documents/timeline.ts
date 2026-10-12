import type { DocumentView } from '../../db/repositories/documents';
import type { OutboxRow } from '../../db/repositories/outbox';
import { SERVER_STATUS_LABEL } from './explain';

export interface TimelineEvent { label: string; at: string | null; tone: 'muted' | 'ok' | 'warn' | 'error' }

/**
 * Línea de tiempo del documento a partir de lo que el teléfono sabe: creación, número provisional, envío, resultado del servidor
 * y estado actual en la oficina (lo refresca el pull de «mis documentos»).
 */
export function buildTimeline(v: DocumentView, ops: OutboxRow[] = []): TimelineEvent[] {
  const d = v.doc;
  const ev: TimelineEvent[] = [{ label: 'Creado en el teléfono', at: d.createdAtDevice, tone: 'muted' }];
  const queued = ops.filter((o) => o.action === 'create').sort((a, b) => a.clientSeq - b.clientSeq);
  if (d.localNumber) ev.push({ label: `Confirmado en el teléfono (${d.localNumber})`, at: queued[0]?.createdAt ?? d.updatedAt, tone: 'muted' });
  for (const o of queued) {
    if (o.status === 'REJECTED') ev.push({ label: 'Rechazado por el servidor', at: null, tone: 'error' });
    else if (o.status === 'REVIEW') ev.push({ label: 'En revisión por administración', at: null, tone: 'warn' });
    else if (o.status === 'PENDING' || o.status === 'SENDING') ev.push({ label: o.attempts ? `En cola de envío (${o.attempts} intento${o.attempts === 1 ? '' : 's'})` : 'En cola de envío', at: null, tone: 'warn' });
  }
  if (d.serverNumber) ev.push({ label: `Recibido por el servidor (${d.serverNumber})`, at: null, tone: 'ok' });
  if (d.serverStatus) {
    const tone = ['CANCELLED', 'REJECTED', 'EXPIRED'].includes(d.serverStatus) ? 'error' : ['INVOICED', 'PARTIALLY_INVOICED', 'CONFIRMED', 'ACCEPTED'].includes(d.serverStatus) ? 'ok' : 'muted';
    ev.push({ label: `Estado actual: ${SERVER_STATUS_LABEL[d.serverStatus] ?? d.serverStatus}`, at: d.localStatus === 'SYNCED' ? d.updatedAt : null, tone });
  }
  return ev;
}
