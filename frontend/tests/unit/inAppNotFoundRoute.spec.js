import { describe, expect, test, vi } from 'vitest';
import NotFound from '@/views/NotFound.vue';

vi.mock('@/services', () => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    apiRequestWithoutSecure: vi.fn()
}));

const { default: router } = await import('@/router');

const CID = 'c1';
const lastRecord = (path) => router.resolve(path).matched.at(-1);

const samplePath = (pattern) => pattern.replace(/:(\w+)(\([^)]*\))?[?*+]?/g, (_, name) => (name === 'cid' ? CID : `${name}-1`));

describe('an unknown url while signed in', () => {
    test.each([`/${CID}/does-not-exist`, `/${CID}/project/p1/nope/deeper/still`])('%s shows the not-found page inside the app shell', async (path) => {
        const resolved = router.resolve(path);
        expect(resolved.meta.requiresAuth).toBe(true);
        expect(resolved.params.cid).toBe(CID);
        const view = await resolved.matched.at(-1).components.default();
        expect(view.default).toBe(NotFound);
    });

    test('the public 404 stays, and needs no sign-in', () => {
        const publicNotFound = router.getRoutes().find((record) => record.name === '404');
        expect(publicNotFound.path).toBe('/:catchAll(.*)');
        expect(publicNotFound.meta.requiresAuth).not.toBe(true);
    });
});

describe('the in-app catch-all shadows no real route', () => {
    const inApp = router.getRoutes().filter((record) => record.path.startsWith('/:cid') && !record.path.includes('catchAll'));

    test('there are company-scoped routes to check', () => {
        expect(inApp.length).toBeGreaterThan(50);
    });

    test.each([
        [`/${CID}`, 'Home'],
        [`/${CID}/`, 'Home'],
        [`/${CID}/inbox`, null],
        [`/${CID}/project/p1/s/s1`, null],
        [`/${CID}/project/p1/s/s1/t1`, null],
        [`/${CID}/whats-new`, 'Changelog']
    ])('%s still opens its own page', (path, name) => {
        const record = lastRecord(path);
        expect(record.path).not.toMatch(/catchAll/);
        if (name) expect(record.name).toBe(name);
    });

    test('every company-scoped route resolves to itself, not to the catch-all', () => {
        const shadowed = inApp
            .map((record) => ({ record, resolved: lastRecord(samplePath(record.path)) }))
            .filter(({ resolved }) => !resolved || resolved.path.includes('catchAll'))
            .map(({ record }) => record.path);
        expect(shadowed).toEqual([]);
    });
});
