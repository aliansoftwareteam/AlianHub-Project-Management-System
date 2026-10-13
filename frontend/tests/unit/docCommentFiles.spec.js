import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({ apiRequest: vi.fn(), apiRequestWithoutCompnay: vi.fn() }));
vi.mock('@/services', () => services);

import { storageQueryBuilder } from '@/utils/storageQueryBuild';
import { removeDocCommentFile, uploadDocCommentFile } from '@/components/molecules/Pages/docCommentFiles';

const fileOf = (name, size = 3) => new File(['x'.repeat(size)], name, { type: 'text/plain' });

beforeEach(() => {
    services.apiRequest.mockReset();
    services.apiRequestWithoutCompnay.mockReset();
});

describe('uploadDocCommentFile', () => {
    it('sends the file to the comment folder of its own doc', async () => {
        services.apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, statusText: 'Pages/p1/Comments/key.txt' } });
        await uploadDocCommentFile({ companyId: 'c1', pageId: 'p1', file: fileOf('notes.txt') });
        const [method, , form, kind] = services.apiRequestWithoutCompnay.mock.calls[0];
        expect(method).toBe('post');
        expect(kind).toBe('form');
        expect(form.get('companyId')).toBe('c1');
        expect(form.get('path')).toMatch(/^Pages\/p1\/Comments\/\d+_notes\.txt$/);
        expect(form.get('file').name).toBe('notes.txt');
    });

    it('gives back the stored key with the original name and size', async () => {
        services.apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, statusText: 'Pages/p1/Comments/9_a.txt' } });
        const out = await uploadDocCommentFile({ companyId: 'c1', pageId: 'p1', file: fileOf('a b.txt', 5) });
        expect(out).toEqual({ mediaURL: 'Pages/p1/Comments/9_a.txt', mediaOriginalName: 'a b.txt', mediaSize: 5 });
    });

    it('replaces spaces in the stored name', async () => {
        services.apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true, statusText: 'k' } });
        await uploadDocCommentFile({ companyId: 'c1', pageId: 'p1', file: fileOf('my plan v2.txt') });
        expect(services.apiRequestWithoutCompnay.mock.calls[0][2].get('path')).toMatch(/_my_plan_v2\.txt$/);
    });

    it('fails with the server reason when the upload is refused', async () => {
        services.apiRequestWithoutCompnay.mockResolvedValue({ data: { status: false, statusText: 'File too large' } });
        await expect(uploadDocCommentFile({ companyId: 'c', pageId: 'p', file: fileOf('a.txt') })).rejects.toThrow('File too large');
    });

    it('fails when the answer holds no stored key', async () => {
        services.apiRequestWithoutCompnay.mockResolvedValue({ data: { status: true } });
        await expect(uploadDocCommentFile({ companyId: 'c', pageId: 'p', file: fileOf('a.txt') })).rejects.toThrow('upload');
    });

    it('fails when nothing answers', async () => {
        services.apiRequestWithoutCompnay.mockResolvedValue(undefined);
        await expect(uploadDocCommentFile({ companyId: 'c', pageId: 'p', file: fileOf('a.txt') })).rejects.toThrow('upload');
    });

    it('lets a network failure through to the caller', async () => {
        services.apiRequestWithoutCompnay.mockImplementation(() => Promise.reject(new Error('offline')));
        await expect(uploadDocCommentFile({ companyId: 'c', pageId: 'p', file: fileOf('a.txt') })).rejects.toThrow('offline');
    });
});

describe('removeDocCommentFile', () => {
    it('asks storage to remove the key for the company', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true } });
        await removeDocCommentFile('c1', 'Pages/p1/Comments/k.txt');
        const expected = storageQueryBuilder('delete', 'c1', 'Pages/p1/Comments/k.txt');
        expect(services.apiRequest).toHaveBeenCalledWith(expected.method, expected.route, expected.data);
    });
});
