// REP-05 — shared report export. Sends a table (head + rows + optional total) to
// the server's CSV/XLSX/PDF endpoint and triggers a browser download. Reusable by any
// report page (Custom Report, Variance, …).
import { apiRequest } from '@/services';
import * as env from '@/config/env';

const ROUTES = { csv: env.EXPORT_CSV, xlsx: env.EXPORT_XLSX, pdf: env.EXPORT_PDF };

/* format: 'csv' | 'xlsx' | 'pdf'. A PDF takes the same table plus title, subtitle and meta lines. */
export async function downloadExport(format, payload) {
    const kind = ROUTES[format] ? format : 'csv';
    const body = kind === 'pdf' ? { type: 'report', params: payload } : payload;
    const resp = await apiRequest('post', ROUTES[kind], body, undefined, { responseType: 'blob' });
    const raw = resp && resp.data;
    if (!raw) return;
    const blob = raw instanceof Blob ? raw : new Blob([raw]);
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${(payload && payload.filename) || 'report'}.${kind}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
}
