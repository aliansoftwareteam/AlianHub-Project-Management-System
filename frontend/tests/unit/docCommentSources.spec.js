import { beforeEach, describe, expect, it, vi } from 'vitest';

const services = vi.hoisted(() => ({ apiRequest: vi.fn() }));
vi.mock('@/services', () => services);

import { docCommentSources } from '@/components/molecules/Pages/docCommentSources';

const people = [
    { id: 'u1', name: 'Ada Lovelace', image: 'ada.png' },
    { id: 'u2', name: 'Grace Hopper', image: '' },
    { id: 'u3', name: 'مريم عبد الله', image: '' },
];

const sourcesFor = (overrides = {}) => docCommentSources({ pageId: () => 'p1', people: () => people, untitled: () => 'Untitled', ...overrides });

beforeEach(() => {
    services.apiRequest.mockReset();
});

describe('people', () => {
    it('offers everybody who can read the doc when nothing is typed', () => {
        expect(sourcesFor().people('').map((item) => item.id)).toEqual(['u1', 'u2', 'u3']);
    });

    it('describes each person for the picker, with initials', () => {
        expect(sourcesFor().people('ada')[0]).toEqual({ type: 'user', id: 'u1', label: 'Ada Lovelace', image: 'ada.png', initials: 'AL' });
    });

    it('matches part of a name in any case and ignores outer spaces', () => {
        expect(sourcesFor().people('  HOPP ').map((item) => item.id)).toEqual(['u2']);
    });

    it('finds a right-to-left name', () => {
        expect(sourcesFor().people('عبد').map((item) => item.id)).toEqual(['u3']);
    });

    it('offers nobody for a name that matches no one', () => {
        expect(sourcesFor().people('zzz')).toEqual([]);
    });

    it('never offers anybody outside the readers list', () => {
        expect(sourcesFor({ people: () => [] }).people('')).toEqual([]);
    });
});

describe('docs', () => {
    const pages = [
        { _id: 'p1', title: 'This doc' },
        { _id: 'p2', title: 'Release notes' },
        { _id: 'p3', title: '' },
        { _id: 'p4' },
    ];

    it('lists the docs the reader can open, without the doc being written in', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: pages } });
        const out = await sourcesFor().docs('');
        expect(out.map((item) => item.id)).toEqual(['p2', 'p3', 'p4']);
        expect(out[0]).toEqual({ type: 'doc', id: 'p2', label: 'Release notes' });
    });

    it('names a doc with no title as untitled', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: pages } });
        const out = await sourcesFor().docs('');
        expect(out[1].label).toBe('Untitled');
        expect(out[2].label).toBe('Untitled');
    });

    it('filters by title text in any case', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: pages } });
        expect((await sourcesFor().docs(' NOTES ')).map((item) => item.id)).toEqual(['p2']);
    });

    it('asks for the list once however many times the picker is used', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: pages } });
        const sources = sourcesFor();
        await Promise.all([sources.docs(''), sources.docs('r'), sources.docs('x')]);
        await sources.docs('');
        expect(services.apiRequest).toHaveBeenCalledTimes(1);
        expect(services.apiRequest.mock.calls[0][1]).toMatch(/scope=all$/);
    });

    it('offers nothing and asks again later when the list could not be read', async () => {
        services.apiRequest.mockImplementationOnce(() => Promise.reject(new Error('offline')));
        const sources = sourcesFor();
        expect(await sources.docs('')).toEqual([]);
        services.apiRequest.mockResolvedValue({ data: { status: true, data: pages } });
        expect((await sources.docs('')).length).toBe(3);
        expect(services.apiRequest).toHaveBeenCalledTimes(2);
    });

    it('offers nothing when the server says no or sends something else', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: false, data: pages } });
        expect(await sourcesFor().docs('')).toEqual([]);
        services.apiRequest.mockResolvedValue({ data: { status: true, data: 'nope' } });
        expect(await sourcesFor().docs('')).toEqual([]);
    });

    it('compares ids as text when leaving out the current doc', async () => {
        services.apiRequest.mockResolvedValue({ data: { status: true, data: [{ _id: 5, title: 'Five' }, { _id: 6, title: 'Six' }] } });
        expect((await sourcesFor({ pageId: () => '5' }).docs('')).map((item) => item.id)).toEqual(['6']);
    });
});

describe('tasks', () => {
    it('searches names and keys, newest first, eight at most', async () => {
        services.apiRequest.mockResolvedValue({ data: [] });
        await sourcesFor().tasks('login');
        const [method, route, body] = services.apiRequest.mock.calls[0];
        expect(method).toBe('post');
        expect(route).toMatch(/\/find$/);
        const [match, project, sort, limit] = body.findQuery;
        expect(match.$match.$or).toEqual([
            { TaskName: { $regex: 'login', $options: 'i' } },
            { TaskKey: { $regex: 'login', $options: 'i' } },
        ]);
        expect(project).toEqual({ $project: { TaskName: 1, TaskKey: 1 } });
        expect(sort).toEqual({ $sort: { updatedAt: -1 } });
        expect(limit).toEqual({ $limit: 8 });
    });

    it('sends text typed with symbols as it was typed, trimmed', async () => {
        services.apiRequest.mockResolvedValue({ data: [] });
        await sourcesFor().tasks('  a.b(c)  ');
        expect(services.apiRequest.mock.calls[0][2].findQuery[0].$match.$or[0].TaskName.$regex).toBe('a.b(c)');
    });

    it('cuts what is typed to the longest text the server takes', async () => {
        services.apiRequest.mockResolvedValue({ data: [] });
        await sourcesFor().tasks('x'.repeat(500));
        expect(services.apiRequest.mock.calls[0][2].findQuery[0].$match.$or[0].TaskName.$regex).toHaveLength(200);
    });

    it('turns each task into a mention item', async () => {
        services.apiRequest.mockResolvedValue({ data: [{ _id: 't1', TaskKey: 'AH-12', TaskName: 'Fix login' }, { _id: 't2', TaskName: 'No key' }] });
        expect(await sourcesFor().tasks('x')).toEqual([
            { type: 'task', id: 't1', label: 'AH-12 Fix login', meta: 'AH-12', name: 'Fix login' },
            { type: 'task', id: 't2', label: 'No key', meta: '', name: 'No key' },
        ]);
    });

    it('offers nothing when the answer is not a list', async () => {
        services.apiRequest.mockResolvedValue({ data: { error: true } });
        expect(await sourcesFor().tasks('x')).toEqual([]);
    });
});
