import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from 'vuex';

const { apiRequest, apiRequestWithoutCompnay, setfinalCustomFieldsArray, setCustomFieldsArray } = vi.hoisted(() => ({
    apiRequest: vi.fn(),
    apiRequestWithoutCompnay: vi.fn(),
    setfinalCustomFieldsArray: vi.fn(),
    setCustomFieldsArray: vi.fn()
}));
vi.mock('@/services/index.js', () => ({ apiRequest, apiRequestWithoutCompnay }));
vi.mock('@/plugins/customFieldView/helper.js', () => ({
    customField: () => ({ setfinalCustomFieldsArray, setCustomFieldsArray })
}));

import settings from '@/store/Settings';

let store;
const g = (name) => store.getters[`settings/${name}`];
const run = (name, payload) => store.dispatch(`settings/${name}`, payload);
const reply = (data, status = 200) => apiRequest.mockResolvedValueOnce({ status, data });
const fail = (message = 'boom') => apiRequest.mockRejectedValueOnce(new Error(message));

beforeEach(() => {
    store = createStore({ modules: { settings: { ...settings, state: structuredClone(settings.state) } } });
    apiRequest.mockReset();
    apiRequestWithoutCompnay.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('setRules', () => {
    const rules = [
        { _id: 'p', isParent: true, name: 'Tasks', key: 'tasks' },
        { _id: 'c', isParent: false, parentId: 'p', name: 'Can Edit' }
    ];

    it('stores raw and arranged rules', async () => {
        reply(rules);
        expect(await run('setRules')).toEqual(rules);
        expect(g('rawRules').map((r) => r._id)).toEqual(['p', 'c']);
        expect(g('rules').tasks.can_edit._id).toBe('c');
    });

    it.each([[[]], [undefined]])('resolves to an empty list and clears rules when the server sends %j', async (data) => {
        reply(data);
        expect(await run('setRules')).toEqual([]);
        expect(g('rules')).toEqual({});
    });

    it('treats a non-200 reply as no rules', async () => {
        reply(rules, 500);
        expect(await run('setRules')).toEqual([]);
        expect(g('rules')).toEqual({});
    });

    // Commits mutateRules with data: [] / op: added, which pushes an empty array into rawRules.
    it.fails('leaves no raw rules when the server has none', async () => {
        reply([]);
        await run('setRules');
        expect(g('rawRules')).toEqual([]);
    });

    it('rejects when the request fails and leaves rules untouched', async () => {
        fail('down');
        await expect(run('setRules')).rejects.toThrow('down');
        expect(g('rawRules')).toEqual([]);
    });
});

describe('setProjectRules', () => {
    const rules = [
        { _id: 'p', isParent: true, name: 'Tasks', key: 'tasks', projectId: 'P1' },
        { _id: 'c', isParent: false, parentId: 'p', name: 'Can Edit', projectId: 'P1' }
    ];

    it('loads and arranges the rules of a project', async () => {
        reply(rules);
        await run('setProjectRules', { pid: 'P1' });
        expect(g('projectRawRules')).toHaveLength(2);
        expect(g('projectRules').tasks.can_edit._id).toBe('c');
    });

    it('does not list a rule twice when the project is loaded again', async () => {
        reply(rules);
        await run('setProjectRules', { pid: 'P1' });
        reply(rules);
        await run('setProjectRules', { pid: 'P1' });
        expect(g('projectRawRules')).toHaveLength(2);
    });

    it('forgets the previous project rules when another project is opened', async () => {
        reply(rules);
        await run('setProjectRules', { pid: 'P1' });
        reply([]);
        await run('setProjectRules', { pid: 'P2' });
        expect(g('projectRawRules')).toEqual([]);
        expect(g('projectRules')).toEqual({});
    });

    it('rejects on a failed request', async () => {
        fail();
        await expect(run('setProjectRules', { pid: 'P1' })).rejects.toThrow('boom');
    });
});

describe('roles, user status, designations, skills', () => {
    const owner = { key: 1, name: 'Owner' };
    const member = { key: 3, name: 'Member' };

    it('setRoles stores roles without the owner for assignment', async () => {
        reply([{ settings: [owner, member] }]);
        expect(await run('setRoles')).toEqual([{ settings: [owner, member] }]);
        expect(g('roles')).toHaveLength(2);
        expect(g('withoutOwnerRoles')).toEqual([member]);
    });

    it('setRoles with no settings document fails inside the commit and rejects', async () => {
        reply([]);
        await expect(run('setRoles')).rejects.toBeDefined();
    });

    it('setRoles on a non-200 resolves [] and keeps roles', async () => {
        reply([], 404);
        expect(await run('setRoles')).toEqual([]);
        expect(g('roles')).toEqual([]);
    });

    it('setRoles rejects on a failed request', async () => {
        fail();
        await expect(run('setRoles')).rejects.toThrow('boom');
    });

    it('setCompanyUserStatus stores the statuses and handles non-200 and errors', async () => {
        reply([{ settings: [{ k: 1 }] }]);
        expect(await run('setCompanyUserStatus')).toEqual([{ settings: [{ k: 1 }] }]);
        expect(g('companyUserStatus')).toEqual([{ k: 1 }]);
        reply([], 500);
        expect(await run('setCompanyUserStatus')).toEqual([]);
        fail();
        await expect(run('setCompanyUserStatus')).rejects.toThrow();
    });

    it('setDesignations stores designations; without a settings document they become empty', async () => {
        reply([{ settings: [{ n: 'Dev' }] }]);
        expect(await run('setDesignations')).toEqual({ settings: [{ n: 'Dev' }] });
        expect(g('designations')).toEqual([{ n: 'Dev' }]);
        reply([]);
        expect(await run('setDesignations')).toBeUndefined();
        expect(g('designations')).toEqual([]);
    });

    it('setDesignations handles non-200 and errors', async () => {
        reply([], 500);
        expect(await run('setDesignations')).toEqual([]);
        fail();
        await expect(run('setDesignations')).rejects.toThrow();
    });

    it('setProjectSkills stores skills, empty when none are configured', async () => {
        reply([{ settings: [{ slug: 'vue', key: 'k' }] }]);
        expect(await run('setProjectSkills')).toEqual({ settings: [{ slug: 'vue', key: 'k' }] });
        expect(g('projectSkills')).toEqual([{ slug: 'vue', key: 'k' }]);
        reply([]);
        await run('setProjectSkills');
        expect(g('projectSkills')).toEqual([]);
    });

    it('setProjectSkills handles non-200 and errors', async () => {
        reply([], 500);
        expect(await run('setProjectSkills')).toEqual([]);
        fail();
        await expect(run('setProjectSkills')).rejects.toThrow();
    });
});

describe('company members', () => {
    it('flags the signed-in member and records the owner', async () => {
        reply({ data: [{ _id: 'm1', userId: 'u1', roleType: 1 }, { _id: 'm2', userId: 'u2', roleType: 3 }] });
        const result = await run('setCompanyUsers', { userId: 'u2' });
        expect(result).toHaveLength(2);
        expect(g('companyUsers').map((u) => u.isCurrentUser)).toEqual([false, true]);
        expect(g('companyUserDetail')._id).toBe('m2');
        expect(g('companyOwnerDetail')._id).toBe('m1');
        expect(g('companyUsers')[1].requestId).toBe('m2');
    });

    it('rejects when the members request fails or the response is empty', async () => {
        fail();
        await expect(run('setCompanyUsers', { userId: 'u' })).rejects.toThrow('boom');
        apiRequest.mockResolvedValueOnce({});
        await expect(run('setCompanyUsers', { userId: 'u' })).rejects.toBeDefined();
    });
});

describe('milestone status', () => {
    it('stores the statuses', async () => {
        reply([{ settings: [{ value: 'OPEN', isCount: 1 }] }]);
        await run('setMileStoneStatus');
        expect(g('projectMilestoneStatus')).toEqual([{ value: 'OPEN', isCount: 1 }]);
    });

    // Resolves res[0] (the axios response indexed) instead of res.data[0].
    it.fails('resolves the loaded settings document', async () => {
        reply([{ settings: [{ value: 'OPEN', isCount: 1 }] }]);
        expect(await run('setMileStoneStatus')).toEqual({ settings: [{ value: 'OPEN', isCount: 1 }] });
    });

    it.each([[[]], [[{ settings: [] }]]])('resolves [] and keeps the list for %j', async (data) => {
        if (data.length === 0) {
            // [0].settings on an empty array throws and is reported as a rejection
            reply(data);
            await expect(run('setMileStoneStatus')).rejects.toBeDefined();
        } else {
            reply(data);
            expect(await run('setMileStoneStatus')).toEqual([]);
        }
        expect(g('projectMilestoneStatus')).toEqual([]);
    });

    it('resolves [] on non-200 and rejects on errors', async () => {
        reply([], 500);
        expect(await run('setMileStoneStatus')).toEqual([]);
        fail();
        await expect(run('setMileStoneStatus')).rejects.toThrow();
    });
});

describe('companies', () => {
    it('setCompanies posts the ids and lists every company', async () => {
        apiRequestWithoutCompnay.mockResolvedValueOnce({ data: [{ _id: 'c1', name: 'A' }, { _id: 'c2', name: 'B' }] });
        const out = await run('setCompanies', ['c1', 'c2']);
        expect(out).toHaveLength(2);
        expect(g('companies').map((c) => c.name)).toEqual(['A', 'B']);
        expect(apiRequestWithoutCompnay.mock.calls[0][2]).toEqual({ companyIds: ['c1', 'c2'] });
    });

    it('setCompanies rejects on failure', async () => {
        apiRequestWithoutCompnay.mockRejectedValueOnce(new Error('x'));
        await expect(run('setCompanies', ['c1'])).rejects.toThrow('x');
    });

    it('setCompanyRefferal puts the referral code on that company', async () => {
        apiRequestWithoutCompnay.mockResolvedValueOnce({ data: [{ _id: 'c1', name: 'A' }] });
        await run('setCompanies', ['c1']);
        reply({ data: 'REF123' });
        await run('setCompanyRefferal', 'c1');
        expect(g('companies')[0]).toEqual({ _id: 'c1', name: 'A', code: 'REF123' });
    });

    it('setCompanyRefferal rejects on failure', async () => {
        fail();
        await expect(run('setCompanyRefferal', 'c1')).rejects.toThrow('boom');
    });

    describe('setSocketCompanies', () => {
        let socket;
        beforeEach(() => {
            socket = { id: 'sock', emit: vi.fn(), on: vi.fn() };
            store.commit('settings/mutateSocketInstance', socket);
        });

        it('refreshes companies from the server and from live updates', async () => {
            store.commit('settings/mutateCompanies', { op: 'added', data: { _id: 'c1', name: 'Old' } });
            apiRequestWithoutCompnay.mockResolvedValueOnce({ data: [{ _id: 'c1', name: 'Fetched' }] });
            const pending = run('setSocketCompanies', { companyId: 'c1' });
            await vi.waitFor(() => expect(socket.on).toHaveBeenCalled());
            await vi.waitFor(() => expect(g('companies')[0].name).toBe('Fetched'));

            const handler = socket.on.mock.calls[0][1];
            handler({ fullDocument: { _id: 'c1', name: 'Live' } });
            await expect(pending).resolves.toEqual({ _id: 'c1', name: 'Live' });
            expect(g('companies')[0].name).toBe('Live');
            expect(socket.emit.mock.calls[0][1].roomName).toBe('selected_companies_c1**sock');
        });

        it('rejects when the company fetch fails', async () => {
            apiRequestWithoutCompnay.mockRejectedValueOnce(new Error('nope'));
            await expect(run('setSocketCompanies', { companyId: 'c1' })).rejects.toThrow('nope');
        });

        it('rejects when there is no socket to join', async () => {
            store.commit('settings/mutateSocketInstance', null);
            apiRequestWithoutCompnay.mockResolvedValueOnce({ data: [] });
            await expect(run('setSocketCompanies', { companyId: 'c1' })).rejects.toBeDefined();
        });
    });
});

describe('file extensions, tabs, priority, date format', () => {
    it('setFileExtentions stores the allowed extensions and returns the document', async () => {
        reply([{ settings: [{ name: 'png' }] }]);
        expect(await run('setFileExtentions')).toEqual({ settings: [{ name: 'png' }] });
        expect(g('fileExtentions')).toEqual([{ name: 'png' }]);
    });

    it('setFileExtentions resolves {} for empty settings or non-200 and rejects on error', async () => {
        reply([{ settings: [] }]);
        expect(await run('setFileExtentions')).toEqual({});
        reply([], 500);
        expect(await run('setFileExtentions')).toEqual({});
        fail();
        await expect(run('setFileExtentions')).rejects.toThrow();
    });

    it('setProjectTabComponents lists tabs and rejects on error', async () => {
        reply([{ _id: 't1' }, { _id: 't2' }]);
        expect(await run('setProjectTabComponents')).toHaveLength(2);
        expect(g('projectTabComponents').map((t) => t._id)).toEqual(['t1', 't2']);
        fail();
        await expect(run('setProjectTabComponents')).rejects.toThrow();
    });

    it('setCompanyPriority stores priorities and resolves them', async () => {
        reply([{ settings: [{ value: 'HIGH' }] }]);
        expect(await run('setCompanyPriority')).toEqual([{ value: 'HIGH' }]);
        expect(g('companyPriority')).toEqual([{ value: 'HIGH' }]);
    });

    it('setCompanyPriority resolves [] when none exist or non-200, rejects on error', async () => {
        reply([{ settings: [] }]);
        expect(await run('setCompanyPriority')).toEqual([]);
        reply([], 500);
        expect(await run('setCompanyPriority')).toEqual([]);
        fail();
        await expect(run('setCompanyPriority')).rejects.toThrow();
    });

    it('setCompayDateFormat stores the first format', async () => {
        reply([{ settings: [{ f: 'DD/MM/YYYY' }] }]);
        expect(await run('setCompayDateFormat')).toEqual({ settings: [{ f: 'DD/MM/YYYY' }] });
        expect(g('companyDateFormat')).toEqual({ f: 'DD/MM/YYYY' });
    });

    it('setCompayDateFormat resolves {} when none is configured, rejects on error', async () => {
        reply([{ settings: [] }]);
        expect(await run('setCompayDateFormat')).toEqual({});
        expect(g('companyDateFormat')).toEqual({});
        fail();
        await expect(run('setCompayDateFormat')).rejects.toThrow();
    });
});

describe('setNotificationRules', () => {
    it('stores the user notification settings from the user url', async () => {
        reply({ email: false });
        expect(await run('setNotificationRules', { userId: 'u1' })).toEqual({ email: false });
        expect(g('notificationSettings')).toEqual({ email: false });
        expect(apiRequest.mock.calls[0][1]).toMatch(/\/u1$/);
    });

    it('falls back to {} for an empty body or a non-200', async () => {
        reply(null);
        expect(await run('setNotificationRules', { userId: 'u1' })).toEqual({});
        store.commit('settings/mutateNotificationSettings', { op: 'added', data: { email: true } });
        reply({ email: true }, 500);
        expect(await run('setNotificationRules', { userId: 'u1' })).toEqual({});
        expect(g('notificationSettings')).toEqual({});
    });

    it('rejects on error', async () => {
        fail();
        await expect(run('setNotificationRules', { userId: 'u1' })).rejects.toThrow();
    });
});

describe('task types and statuses', () => {
    it.each([
        ['setTaskType', 'taskType', 'projectTaskType'],
        ['setTaskStatus', 'taskStatus', 'projectTaskStatus']
    ])('%s fills the company list and an independent project copy', async (action, companyKey, projectKey) => {
        reply([{ _id: 'a', name: 'Bug' }, { _id: 'b', name: 'Story' }]);
        expect(await run(action)).toHaveLength(2);
        expect(g(companyKey).map((x) => x.name)).toEqual(['Bug', 'Story']);
        expect(g(projectKey).map((x) => x.name)).toEqual(['Bug', 'Story']);
        store.commit('settings/mutateTaskType', { op: 'removed', data: { _id: 'a' } });
        expect(g(projectKey)).toHaveLength(2);
    });

    it.each(['setTaskType', 'setTaskStatus'])('%s resolves [] for no data / non-200 and rejects on error', async (action) => {
        reply([]);
        expect(await run(action)).toEqual([]);
        reply([{ _id: 'a' }], 500);
        expect(await run(action)).toEqual([]);
        fail();
        await expect(run(action)).rejects.toThrow('boom');
    });

    it('setCategory stores the category list; a missing document rejects', async () => {
        reply([{ settings: ['Dev', 'QA'] }]);
        expect(await run('setCategory')).toEqual({ settings: ['Dev', 'QA'] });
        expect(g('category')).toEqual(['Dev', 'QA']);
        reply([]);
        await expect(run('setCategory')).rejects.toBeDefined();
    });
});

describe('milestone range, teams, restricted extensions', () => {
    it('setMileStoneWeeklyRange stores and resolves the first range', async () => {
        reply([{ settings: ['mon-fri', 'x'] }]);
        expect(await run('setMileStoneWeeklyRange')).toBe('mon-fri');
        expect(g('milestoneweeklyrange')).toBe('mon-fri');
    });

    it('setMileStoneWeeklyRange resolves [] when empty/non-200 and rejects on error', async () => {
        reply([{ settings: [] }]);
        expect(await run('setMileStoneWeeklyRange')).toEqual([]);
        reply([], 500);
        expect(await run('setMileStoneWeeklyRange')).toEqual([]);
        fail();
        await expect(run('setMileStoneWeeklyRange')).rejects.toThrow();
    });

    it('setTeams lists teams closed for editing', async () => {
        reply([{ _id: 't1', name: 'Core', isEdit: true }, { _id: 't2', name: 'QA' }]);
        const out = await run('setTeams');
        expect(out.every((t) => t.isEdit === false && t.isPopupOpen === false)).toBe(true);
        expect(g('teams').map((t) => t.name)).toEqual(['Core', 'QA']);
    });

    it('setTeams with no teams resolves an empty list; failure rejects', async () => {
        reply([]);
        expect(await run('setTeams')).toEqual([]);
        fail();
        await expect(run('setTeams')).rejects.toThrow();
    });

    it('setRestrictedExtensions stores the blocked extensions, empty when missing', async () => {
        reply({ data: { extensions: ['exe', 'bat'] } });
        await run('setRestrictedExtensions');
        expect(g('restrictedExtensions')).toEqual(['exe', 'bat']);
        reply({ data: null });
        expect(await run('setRestrictedExtensions')).toBeNull();
        expect(g('restrictedExtensions')).toEqual([]);
        fail();
        await expect(run('setRestrictedExtensions')).rejects.toThrow();
    });
});

describe('custom fields delegation', () => {
    it('hands the commit to the custom-field helpers', () => {
        run('setCustomFields');
        run('setfinalCustomFields');
        expect(setCustomFieldsArray).toHaveBeenCalledWith({ commit: expect.any(Function) });
        expect(setfinalCustomFieldsArray).toHaveBeenCalledWith({ commit: expect.any(Function) });
    });
});

describe('setTimeTrackerDownload', () => {
    it('stores the tracker rows and asks for the first page of front-end data', async () => {
        apiRequest.mockResolvedValueOnce({ data: { status: true, data: [{ id: 1 }] } });
        expect(await run('setTimeTrackerDownload')).toEqual([{ id: 1 }]);
        expect(g('TimeTracker')).toEqual([{ id: 1 }]);
        expect(apiRequest.mock.calls[0][1]).toContain('currentPage=1');
        expect(apiRequest.mock.calls[0][1]).toContain('source=front');
    });

    it('clears the rows when the server reports failure', async () => {
        store.commit('settings/mutateTimeTrackerDownload', [{ id: 9 }]);
        apiRequest.mockResolvedValueOnce({ data: { status: false } });
        expect(await run('setTimeTrackerDownload')).toEqual([]);
        expect(g('TimeTracker')).toEqual([]);
    });

    it('rejects on a network error', async () => {
        fail();
        await expect(run('setTimeTrackerDownload')).rejects.toThrow();
    });
});

describe('template arrays', () => {
    it.each([
        ['setTaskStatusArray', 'AllTaskStatus'],
        ['setProjectStatusArray', 'AllProjectStatus'],
        ['setTaskTypeArray', 'AllTaskType']
    ])('%s resolves the first template and keeps the last in state', async (action, getter) => {
        reply([{ _id: 'a', v: 1 }, { _id: 'b', v: 2 }]);
        expect(await run(action)).toEqual({ _id: 'a', v: 1 });
        expect(g(getter)).toEqual({ _id: 'b', v: 2 });
    });

    it.each(['setTaskStatusArray', 'setProjectStatusArray', 'setTaskTypeArray'])('%s resolves [] on non-200 and rejects on error', async (action) => {
        reply([], 500);
        expect(await run(action)).toEqual([]);
        fail();
        await expect(run(action)).rejects.toThrow('boom');
    });
});

describe('currency, project status, plan features', () => {
    it('setCurrencyArray stores currencies', async () => {
        reply([{ _id: 'usd', count: 2 }]);
        expect(await run('setCurrencyArray')).toEqual([{ _id: 'usd', count: 2 }]);
        expect(g('allCurrencyArray')).toEqual([{ _id: 'usd', count: 2 }]);
    });

    it('setCurrencyArray resolves [] on non-200 and rejects on error', async () => {
        reply([], 500);
        expect(await run('setCurrencyArray')).toEqual([]);
        expect(g('allCurrencyArray')).toEqual([]);
        fail();
        await expect(run('setCurrencyArray')).rejects.toThrow();
    });

    it('setProjectStatus fills the project statuses and an independent store copy', async () => {
        apiRequest.mockResolvedValueOnce({ data: { data: [{ _id: 's1', name: 'Active' }] } });
        expect(await run('setProjectStatus')).toEqual([{ _id: 's1', name: 'Active' }]);
        expect(g('projectStaus')).toEqual([{ _id: 's1', name: 'Active' }]);
        expect(g('projectStatusStore')).toEqual([{ _id: 's1', name: 'Active' }]);
    });

    it('setProjectStatus rejects on error and lists nothing for a malformed response', async () => {
        fail();
        await expect(run('setProjectStatus')).rejects.toThrow();
        apiRequest.mockResolvedValueOnce({ data: {} });
        await run('setProjectStatus');
        expect(g('projectStaus')).toEqual([]);
    });

    it('setplanFeatureDisplay stores features, [] when body is empty', async () => {
        reply([{ f: 1 }]);
        expect(await run('setplanFeatureDisplay')).toEqual([{ f: 1 }]);
        expect(g('planFeatureDisplay')).toEqual([{ f: 1 }]);
        reply(null);
        expect(await run('setplanFeatureDisplay')).toEqual([]);
        expect(g('planFeatureDisplay')).toEqual([]);
        fail();
        await expect(run('setplanFeatureDisplay')).rejects.toThrow();
    });
});
