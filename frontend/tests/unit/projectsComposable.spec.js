import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    company: { value: undefined }
}));

vi.mock('vuex', () => ({ useStore: () => ({ getters: { get 'settings/selectedCompany'() { return m.company.value; } } }) }));
vi.mock('@/services', () => ({ apiRequest: m.apiRequest }));
vi.mock('@/locales/main', () => ({ i18n: { global: { t: (k) => k } } }));
vi.mock('@/config/env', () => ({ PROJECTACTIONS: 'projects' }));

import { useProjects } from '@/composable/projects';
import { clockText, followClockPrefs, fullText } from '@/utils/clockText';

// 2024-03-05 15:07 local time
const AT = new Date(2024, 2, 5, 15, 7).getTime();
const plan = (planFeature, projectCount) => { m.company.value = { planFeature, projectCount }; };

describe('useProjects', () => {
    let p;
    beforeEach(() => {
        m.apiRequest.mockReset();
        m.company.value = undefined;
        p = useProjects();
    });

    describe('markFavourite', () => {
        it('adds to favourites and reports it', async () => {
            m.apiRequest.mockResolvedValue({});
            await expect(p.markFavourite({ projectId: 'p1', userId: 'u1' })).resolves.toBe('Toast.Added_to_favourite');
            expect(m.apiRequest).toHaveBeenCalledWith('put', '/api/v1/projects/p1', { updateObject: { favouriteTasks: { userId: 'u1' } }, key: '$addToSet' });
        });

        it('removes from favourites when existing data is passed', async () => {
            m.apiRequest.mockResolvedValue({});
            await expect(p.markFavourite({ projectId: 'p1', userId: 'u1', data: { x: 1 } })).resolves.toBe('Toast.Removed_from_favourite');
            expect(m.apiRequest.mock.calls[0][2].key).toBe('$pull');
        });

        it('rejects with the API error when saving fails', async () => {
            const err = new Error('boom');
            m.apiRequest.mockRejectedValue(err);
            await expect(p.markFavourite({ projectId: 'p1', userId: 'u1' })).rejects.toBe(err);
        });

        it('rejects when the request cannot even be started', async () => {
            const err = new Error('sync');
            m.apiRequest.mockImplementation(() => { throw err; });
            await expect(p.markFavourite({ projectId: 'p1' })).rejects.toBe(err);
        });

        it('treats undefined data as an add', async () => {
            m.apiRequest.mockResolvedValue({});
            await expect(p.markFavourite({ projectId: 'p1', userId: 'u1', data: undefined })).resolves.toBe('Toast.Added_to_favourite');
        });
    });

    describe('time display', () => {
        beforeEach(() => followClockPrefs({ timeFormat: '12', dateFormat: 'DD MMM YYYY' }));

        it('shows 12-hour time when the person chose 12', () => {
            expect(p.getDateType(AT)).toBe('3:07 PM');
        });
        it('shows 24-hour time when the person chose 24', () => {
            followClockPrefs({ timeFormat: '24' });
            expect(p.getDateType(AT)).toBe('15:07');
        });
        it('shows 12-hour time when the person has chosen nothing', () => {
            followClockPrefs();
            expect(p.getDateType(AT)).toBe('3:07 PM');
        });
        it('gives no text for a time that is no time', () => {
            expect([p.getDateType(undefined), p.getDateType('not a date'), p.getDateAndTime(undefined)]).toEqual(['', '', '']);
        });

        it('joins the workspace date and the 12-hour time', () => {
            expect(p.getDateAndTime(AT)).toBe('05 Mar 2024, 3:07 PM');
        });
        it('joins the workspace date and the 24-hour time', () => {
            followClockPrefs({ timeFormat: '24', dateFormat: 'DD MMM YYYY' });
            expect(p.getDateAndTime(AT)).toBe('05 Mar 2024, 15:07');
        });
        it('writes the date day first when the workspace has set none', () => {
            followClockPrefs({ timeFormat: '24' });
            expect(p.getDateAndTime(AT)).toBe('05/03/2024, 15:07');
        });
        it('is the one helper every other screen writes a time with', () => {
            expect([p.getDateType, p.getDateAndTime]).toEqual([clockText, fullText]);
        });
    });

    describe('checkSpecificTypeCount', () => {
        it('allows public projects while below the limit', () => {
            plan({ maxPublicProject: 3 }, { publicCount: 2 });
            expect(p.checkSpecificTypeCount('public')).toBe(true);
        });
        it('refuses public projects at the limit', () => {
            plan({ maxPublicProject: 3 }, { publicCount: 3 });
            expect(p.checkSpecificTypeCount('public')).toBe(false);
        });
        it('refuses public projects over the limit', () => {
            plan({ maxPublicProject: 3 }, { publicCount: 5 });
            expect(p.checkSpecificTypeCount('public')).toBe(false);
        });
        it('allows unlimited public projects (null limit)', () => {
            plan({ maxPublicProject: null }, { publicCount: 999 });
            expect(p.checkSpecificTypeCount('public')).toBe(true);
        });
        it('judges private projects by the private limit only', () => {
            plan({ maxPublicProject: 0, maxPrivateProject: 2 }, { publicCount: 9, privateCount: 1 });
            expect(p.checkSpecificTypeCount('private')).toBe(true);
            plan({ maxPublicProject: 0, maxPrivateProject: 2 }, { privateCount: 2 });
            expect(p.checkSpecificTypeCount('private')).toBe(false);
        });
        it('allows unlimited private projects (null limit)', () => {
            plan({ maxPrivateProject: null }, { privateCount: 50 });
            expect(p.checkSpecificTypeCount('private')).toBe(true);
        });
        it('counts as zero used when no counts are reported', () => {
            plan({ maxPublicProject: 1 }, undefined);
            expect(p.checkSpecificTypeCount('public')).toBe(true);
        });
        it('refuses when the limit is missing from the plan', () => {
            plan({}, { publicCount: 0 });
            expect(p.checkSpecificTypeCount('public')).toBe(false);
        });
        it('gives no answer for an unknown project type', () => {
            plan({ maxPublicProject: 5 }, {});
            expect(p.checkSpecificTypeCount('secret')).toBeUndefined();
        });
        it('follows a company that changes later', () => {
            plan({ maxPublicProject: 1 }, { publicCount: 1 });
            expect(p.checkSpecificTypeCount('public')).toBe(false);
            plan({ maxPublicProject: 2 }, { publicCount: 1 });
            expect(p.checkSpecificTypeCount('public')).toBe(true);
        });
    });

    describe('checkProjectPlan', () => {
        it('refuses when no company or plan is loaded yet', () => {
            expect(p.checkProjectPlan('public')).toBe(false);
            m.company.value = { projectCount: {} };
            expect(p.checkProjectPlan('public')).toBe(false);
        });
        it('only looks at the per-type limit when the plan has no overall limit', () => {
            plan({ project: null, maxPublicProject: 1 }, { projectCount: 100, publicCount: 0 });
            expect(p.checkProjectPlan('public')).toBe(true);
        });
        it('allows a project while the overall limit has room', () => {
            plan({ project: 5, maxPublicProject: null }, { projectCount: 4 });
            expect(p.checkProjectPlan('public')).toBe(true);
        });
        it('refuses once the overall limit is reached', () => {
            plan({ project: 5, maxPublicProject: null }, { projectCount: 5 });
            expect(p.checkProjectPlan('public')).toBe(false);
        });
        it('still refuses at the overall limit when the type is unlimited', () => {
            plan({ project: 1, maxPrivateProject: null }, { projectCount: 1 });
            expect(p.checkProjectPlan('private')).toBe(false);
        });
        it('refuses when the overall limit has room but the type limit is used up', () => {
            plan({ project: 10, maxPrivateProject: 1 }, { projectCount: 2, privateCount: 1 });
            expect(p.checkProjectPlan('private')).toBe(false);
        });
        it('treats a missing project count as zero', () => {
            plan({ project: 1, maxPublicProject: null }, undefined);
            expect(p.checkProjectPlan('public')).toBe(true);
        });
        it('refuses a new project when the company is already over its overall limit', () => {
            plan({ project: 5, maxPublicProject: null }, { projectCount: 7 });
            expect(p.checkProjectPlan('public')).toBe(false);
        });
        it('refuses everything when the overall limit is zero', () => {
            plan({ project: 0, maxPublicProject: null }, { projectCount: 0 });
            expect(p.checkProjectPlan('public')).toBe(false);
        });
    });
});
