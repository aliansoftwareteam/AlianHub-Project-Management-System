import { apiRequest } from '@/services';

// Render a payload to a branded PDF via the Export endpoint (S4-04) and download
// it. The backend renders whatever the client passes (table rows / chart images),
// so the PDF matches exactly what's on screen.
export async function downloadReportPdf(type, params) {
    const res = await apiRequest('post', '/api/v1/export/pdf', { type, params }, undefined, { responseType: 'blob' });
    const blob = res.data;
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(params && params.filename) || type}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
}

// Get a PNG dataURI from a vue3-apexcharts component ref, to embed in the PDF.
// Returns null on any failure so the PDF still generates (without the image).
export async function chartImage(chartRef) {
    try {
        const inst = chartRef && (chartRef.value || chartRef);
        if (inst && typeof inst.dataURI === 'function') {
            const out = await inst.dataURI();
            return out && out.imgURI ? out.imgURI : null;
        }
    } catch (e) {
        // ignore — image is optional
    }
    return null;
}
