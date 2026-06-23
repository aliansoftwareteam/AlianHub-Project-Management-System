// REP-05 — shared report export. Sends a table (head + rows + optional total) to
// the server's CSV/XLSX endpoint and triggers a browser download. Reusable by any
// report page (Custom Report, Variance, …).
import { apiRequest } from '@/services';
import * as env from '@/config/env';

export async function downloadExport(format, payload) {
    const isXlsx = format === 'xlsx';
    const url = isXlsx ? env.EXPORT_XLSX : env.EXPORT_CSV;
    const resp = await apiRequest('post', url, payload, undefined, { responseType: 'blob' });
    const raw = resp && resp.data;
    if (!raw) return;
    const blob = raw instanceof Blob ? raw : new Blob([raw]);
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = `${(payload && payload.filename) || 'report'}.${isXlsx ? 'xlsx' : 'csv'}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
}
