import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services', () => ({ apiRequest: vi.fn(() => Promise.resolve({ data: { status: true } })) }));

import { createVisitRecorder, visitsForRoute } from '@/components/molecules/RecentVisits/routeVisits';

const P = '6f0000000000000000000a01';
const S = '6f0000000000000000000d01';
const S2 = '6f0000000000000000000d02';
const F = '6f0000000000000000000f01';
const D = '6f0000000000000000000e01';
const T = '6f0000000000000000000b01';
const at = (name, params = {}, query = {}) => ({ name, params: { cid: 'c1', ...params }, query, meta: { requiresAuth: true } });

describe('which visits a route records', () => {
    it('records the project and its sprint on every project route', () => {
        expect(visitsForRoute(at('Project', { id: P }))).toEqual([{ entityType: 'project', entityId: P }]);
        expect(visitsForRoute(at('ProjectSprint', { id: P, sprintId: S }))).toEqual([
            { entityType: 'project', entityId: P },
            { entityType: 'sprint', entityId: S },
        ]);
        expect(visitsForRoute(at('ProjectFolderSprintTask', { id: P, folderId: F, sprintId: S, taskId: T }))).toEqual([
            { entityType: 'project', entityId: P },
            { entityType: 'sprint', entityId: S },
        ]);
    });

    it('records a doc opened in the editor or in the docs space', () => {
        expect(visitsForRoute(at('PageEditor', { pageId: D }))).toEqual([{ entityType: 'doc', entityId: D }]);
        expect(visitsForRoute(at('Pages', {}, { page: D }))).toEqual([{ entityType: 'doc', entityId: D }]);
        expect(visitsForRoute(at('Pages'))).toEqual([]);
    });

    it('records nothing for other pages, public pages or malformed ids', () => {
        expect(visitsForRoute(at('Home'))).toEqual([]);
        expect(visitsForRoute(at('ProjectSprint', { id: 'new', sprintId: 'x' }))).toEqual([]);
        expect(visitsForRoute({ ...at('PageEditor', { pageId: D }), meta: { requiresAuth: false } })).toEqual([]);
        expect(visitsForRoute(null)).toEqual([]);
    });
});

describe('the visit recorder', () => {
    it('sends each visit once while the person stays on it, and again after leaving', () => {
        const send = vi.fn();
        const record = createVisitRecorder(send);
        record(at('ProjectSprint', { id: P, sprintId: S }));
        expect(send.mock.calls.map(([v]) => v.entityType)).toEqual(['project', 'sprint']);

        record(at('ProjectSprint', { id: P, sprintId: S }, { tab: 'ProjectKanban' }));
        record(at('ProjectSprintTask', { id: P, sprintId: S, taskId: T }));
        expect(send).toHaveBeenCalledTimes(2);

        record(at('ProjectSprint', { id: P, sprintId: S2 }));
        expect(send).toHaveBeenCalledTimes(3);
        expect(send).toHaveBeenLastCalledWith({ entityType: 'sprint', entityId: S2 });

        record(at('Home'));
        record(at('ProjectSprint', { id: P, sprintId: S2 }));
        expect(send).toHaveBeenCalledTimes(5);
    });
});
