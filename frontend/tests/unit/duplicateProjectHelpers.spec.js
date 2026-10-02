import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => services);

import { duplicateProgress, duplicateProject, linkedTo, shareFields } from '@/views/Projects/duplicateProject';

const refused = (data) => services.apiRequest.mockImplementation(() => Promise.reject({ response: { data } }));

beforeEach(() => {
    services.apiRequest.mockReset();
});

describe('duplicateProject', () => {
    it('posts the name and what to include to the project copy route', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { project: { _id: 'p2' } } } });
        await duplicateProject('p1', { name: 'Copy of Roadmap', include: { tasks: true } });
        const [method, route, body] = services.apiRequest.mock.calls[0];
        expect(method).toBe('post');
        expect(route).toMatch(/\/p1\/duplicate$/);
        expect(body).toEqual({ name: 'Copy of Roadmap', include: { tasks: true } });
    });

    it('answers ok with everything the server sent', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { project: { _id: 'p2' }, fieldIds: ['f1'] } } });
        expect(await duplicateProject('p1', { name: 'n', include: {} })).toEqual({ ok: true, project: { _id: 'p2' }, fieldIds: ['f1'] });
    });

    it('answers not ok with the reason when the server refuses on a 200', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: false, statusText: 'Name taken' } });
        expect(await duplicateProject('p1', { name: 'n', include: {} })).toEqual({ ok: false, message: 'Name taken' });
    });

    it('answers not ok when the answer has no project', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: {} } });
        expect(await duplicateProject('p1', { name: 'n', include: {} })).toEqual({ ok: false, message: '' });
    });

    it('answers not ok with the reason when the server refuses with an HTTP error', async () => {
        refused({ statusText: 'No permission' });
        expect(await duplicateProject('p1', { name: 'n', include: {} })).toEqual({ ok: false, message: 'No permission' });
    });

    it('answers not ok with no message when the failure carries none', async () => {
        services.apiRequest.mockImplementation(() => Promise.reject(new Error('offline')));
        expect(await duplicateProject('p1', { name: 'n', include: {} })).toEqual({ ok: false, message: '' });
    });
});

describe('linkedTo', () => {
    it('is true when the field names the project', () => {
        expect(linkedTo({ projectId: ['p1', 'p2'] }, 'p2')).toBe(true);
    });

    it('is false when the field names other projects', () => {
        expect(linkedTo({ projectId: ['p1'] }, 'p2')).toBe(false);
    });

    it('accepts one project id as plain text and compares ids as text', () => {
        expect(linkedTo({ projectId: 'p1' }, 'p1')).toBe(true);
        expect(linkedTo({ projectId: [7] }, '7')).toBe(true);
        expect(linkedTo({ projectId: ['7'] }, 7)).toBe(true);
    });

    it('is false for a global field, which needs no link', () => {
        expect(linkedTo({ global: true, projectId: ['p1'] }, 'p1')).toBe(false);
    });

    it('is false for a field with no projects', () => {
        expect(linkedTo({}, 'p1')).toBe(false);
        expect(linkedTo({ projectId: null }, 'p1')).toBe(false);
    });
});

describe('shareFields', () => {
    const storeWith = (fields) => ({ getters: { 'settings/finalCustomFields': fields }, commit: vi.fn() });

    it('adds the new project to a field that lacked it', () => {
        const store = storeWith([{ _id: 'f1', projectId: ['p1'] }]);
        shareFields(store, ['f1'], 'p2');
        expect(store.commit).toHaveBeenCalledWith('settings/mutateFinalCustomFields', { op: 'modified', data: { _id: 'f1', projectId: ['p1', 'p2'] } });
    });

    it('turns a single project id into a list when adding', () => {
        const store = storeWith([{ _id: 'f1', projectId: 'p1' }]);
        shareFields(store, ['f1'], 'p2');
        expect(store.commit.mock.calls[0][1].data.projectId).toEqual(['p1', 'p2']);
    });

    it('leaves alone a field that already names the project', () => {
        const store = storeWith([{ _id: 'f1', projectId: ['p2'] }]);
        shareFields(store, ['f1'], 'p2');
        expect(store.commit).not.toHaveBeenCalled();
    });

    it('skips ids the store does not know', () => {
        const store = storeWith([{ _id: 'f1', projectId: [] }]);
        shareFields(store, ['missing'], 'p2');
        expect(store.commit).not.toHaveBeenCalled();
    });

    it('copes with no fields in the store and no ids', () => {
        const empty = { getters: {}, commit: vi.fn() };
        expect(() => shareFields(empty, ['f1'], 'p2')).not.toThrow();
        expect(() => shareFields(storeWith([]), undefined, 'p2')).not.toThrow();
        expect(empty.commit).not.toHaveBeenCalled();
    });

    it('matches ids as text', () => {
        const store = storeWith([{ _id: 5, projectId: [] }]);
        shareFields(store, ['5'], 'p2');
        expect(store.commit).toHaveBeenCalledTimes(1);
    });
});

describe('duplicateProgress', () => {
    it('reads progress from the route of the new project', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: { done: 40, total: 100 } } });
        expect(await duplicateProgress('p2')).toEqual({ done: 40, total: 100 });
        const [method, route] = services.apiRequest.mock.calls[0];
        expect(method).toBe('get');
        expect(route).toMatch(/\/p2\/duplicate$/);
    });

    it('answers null when the server says no, so the caller asks again', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: false } });
        expect(await duplicateProgress('p2')).toBeNull();
    });

    it('answers null when the read fails', async () => {
        services.apiRequest.mockImplementation(() => Promise.reject(new Error('offline')));
        expect(await duplicateProgress('p2')).toBeNull();
    });
});
