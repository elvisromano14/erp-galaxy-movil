import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildDocumentHtml, type PdfData } from './pdfHtml';

/** Genera el PDF en el teléfono y abre el menú de compartir (WhatsApp, correo, …). Funciona sin conexión. */
export async function shareDocumentPdf(data: PdfData): Promise<'shared' | 'unavailable'> {
  const { uri } = await Print.printToFileAsync({ html: buildDocumentHtml(data) });
  if (!(await Sharing.isAvailableAsync())) return 'unavailable';
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `${data.kind} ${data.number}` });
  return 'shared';
}
