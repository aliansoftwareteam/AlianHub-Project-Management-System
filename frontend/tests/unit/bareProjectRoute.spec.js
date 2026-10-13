import { describe, expect, test, vi } from 'vitest';

vi.mock('@/services', () => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    apiRequestWithoutSecure: vi.fn()
}));

const { default: router } = await import('@/router');

const lastRecord = (path) => router.resolve(path).matched.at(-1);
const followRedirect = (path) => {
    const from = router.resolve(path);
    const record = from.matched.at(-1);
    const target = typeof record?.redirect === 'function' ? record.redirect(from) : record?.redirect;
    return target ? router.resolve(target) : from;
};

describe('a bare project link', () => {
    test('/:cid/project/:id opens the project at its default view, as the sidebar does', () => {
        const landed = followRedirect('/c1/project/p1');
        expect(landed.name).toBe('Project');
        expect(landed.params).toMatchObject({ cid: 'c1', id: 'p1' });
        expect(landed.path).toBe('/c1/project/p1/p');
        expect(landed.meta.requiresAuth).toBe(true);
    });

    test('keeps the query and hash of the link', () => {
        const landed = followRedirect('/c1/project/p1?tab=ProjectKanban#top');
        expect(landed.name).toBe('Project');
        expect(landed.query).toEqual({ tab: 'ProjectKanban' });
        expect(landed.hash).toBe('#top');
    });

    test('is not the not-found page', () => {
        const record = lastRecord('/c1/project/p1');
        expect(record.name).not.toBe('404');
        expect(record.path).toBe('/:cid/project/:id');
    });

    test('ranks above an in-app catch-all', () => {
        const remove = router.addRoute({ path: '/:cid/:catchAll+', name: 'InAppCatchAllProbe', component: { render: () => null } });
        try {
            expect(lastRecord('/c1/project/p1').path).toBe('/:cid/project/:id');
            expect(lastRecord('/c1/elsewhere').path).toMatch(/catchAll/);
        } finally {
            remove();
        }
    });

    test.each([
        ['/c1/project', 'Projects'],
        ['/c1/project/p1/p', 'Project'],
        ['/c1/project/p1/s/s1', 'ProjectSprint'],
        ['/c1/project/p1/s/s1/t1', 'ProjectSprintTask'],
        ['/c1/project/p1/recurring', 'ProjectRecurringTasks']
    ])('%s still opens its own page', (path, name) => {
        expect(lastRecord(path).name).toBe(name);
    });
});
