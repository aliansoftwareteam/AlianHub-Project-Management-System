import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => services);

import { chartImage, downloadReportPdf } from '@/views/Projects/Reports/reportsPdf';

describe('downloadReportPdf', () => {
    let clicked;
    let created;
    let revoked;

    beforeEach(() => {
        services.apiRequest.mockReset();
        clicked = [];
        created = [];
        revoked = [];
        window.URL.createObjectURL = vi.fn((blob) => { created.push(blob); return 'blob:report-1'; });
        window.URL.revokeObjectURL = vi.fn((url) => { revoked.push(url); });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() {
            clicked.push({ href: this.href, download: this.download, attached: document.body.contains(this) });
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('asks the export route for a blob of the report type and params', async () => {
        services.apiRequest.mockResolvedValue({ data: new Blob(['%PDF']) });
        await downloadReportPdf('velocity', { rows: [1, 2] });
        const [method, route, body, , options] = services.apiRequest.mock.calls[0];
        expect(method).toBe('post');
        expect(route).toBe('/api/v1/export/pdf');
        expect(body).toEqual({ type: 'velocity', params: { rows: [1, 2] } });
        expect(options).toEqual({ responseType: 'blob' });
    });

    it('saves the file under the name the caller gave', async () => {
        services.apiRequest.mockResolvedValue({ data: new Blob(['%PDF']) });
        await downloadReportPdf('velocity', { filename: 'Sprint 12 - Velocity' });
        expect(clicked).toHaveLength(1);
        expect(clicked[0].download).toBe('Sprint 12 - Velocity.pdf');
        expect(clicked[0].href).toBe('blob:report-1');
    });

    it('names the file after the report type when no name was given', async () => {
        services.apiRequest.mockResolvedValue({ data: new Blob(['%PDF']) });
        await downloadReportPdf('cfd');
        expect(clicked[0].download).toBe('cfd.pdf');
        await downloadReportPdf('burndown', {});
        expect(clicked[1].download).toBe('burndown.pdf');
    });

    it('keeps a right-to-left file name', async () => {
        services.apiRequest.mockResolvedValue({ data: new Blob(['%PDF']) });
        await downloadReportPdf('velocity', { filename: 'تقرير السرعة' });
        expect(clicked[0].download).toBe('تقرير السرعة.pdf');
    });

    it('clicks a link that is on the page, then removes it and frees the blob', async () => {
        const blob = new Blob(['%PDF']);
        services.apiRequest.mockResolvedValue({ data: blob });
        await downloadReportPdf('cfd', {});
        expect(clicked[0].attached).toBe(true);
        expect(document.querySelectorAll('a[download]')).toHaveLength(0);
        expect(created).toEqual([blob]);
        expect(revoked).toEqual(['blob:report-1']);
    });

    it('saves nothing when the export fails', async () => {
        services.apiRequest.mockImplementation(() => Promise.reject(new Error('500')));
        await expect(downloadReportPdf('cfd', {})).rejects.toThrow('500');
        expect(clicked).toEqual([]);
        expect(created).toEqual([]);
    });
});

describe('chartImage', () => {
    it('gives back the picture of a chart as an address', async () => {
        const chart = { dataURI: vi.fn(() => Promise.resolve({ imgURI: 'data:image/png;base64,AAAA' })) };
        expect(await chartImage(chart)).toBe('data:image/png;base64,AAAA');
    });

    it('reads a chart held in a ref', async () => {
        const ref = { value: { dataURI: () => Promise.resolve({ imgURI: 'data:image/png;base64,BBBB' }) } };
        expect(await chartImage(ref)).toBe('data:image/png;base64,BBBB');
    });

    it('gives null when the chart is not drawn yet', async () => {
        expect(await chartImage(null)).toBeNull();
        expect(await chartImage(undefined)).toBeNull();
        expect(await chartImage({ value: null })).toBeNull();
    });

    it('gives null when the component cannot make a picture', async () => {
        expect(await chartImage({ value: {} })).toBeNull();
        expect(await chartImage({ dataURI: 'nope' })).toBeNull();
    });

    it('gives null when the picture has no address', async () => {
        expect(await chartImage({ dataURI: () => Promise.resolve({}) })).toBeNull();
        expect(await chartImage({ dataURI: () => Promise.resolve(null) })).toBeNull();
    });

    it('gives null instead of failing when drawing the picture fails', async () => {
        expect(await chartImage({ dataURI: () => Promise.reject(new Error('canvas')) })).toBeNull();
        expect(await chartImage({ dataURI: () => { throw new Error('sync'); } })).toBeNull();
    });
});
