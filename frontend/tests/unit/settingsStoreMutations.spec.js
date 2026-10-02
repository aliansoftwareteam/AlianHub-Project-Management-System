import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as m from '@/store/Settings/mutations';

let state;
beforeEach(() => {
    state = {
        rawRules: [], rules: {}, projectRules: {}, projectRawRules: [], roles: [], withoutOwnerRoles: [],
        companyUsers: [], companyUserDetail: {}, companyOwnerDetail: {}, companyUserStatus: [], designations: [],
        projectSkills: [], projectMilestone: [], companies: [], selectedCompanyId: '', fileExtentions: [],
        projectTabComponents: [], companyPriority: [], companyDateFormat: {}, notificationSettings: {},
        taskType: [], taskStatus: [], category: [], milestoneweeklyrange: [], teams: [], customFields: [],
        restrictedExtensions: [], finalCustomFields: [], TimeTracker: [], TaskStatusArray: [], projectStatusArray: [],
        currencyArray: [], projectStaus: [], taskTypeArray: [], planFeatureDisplay: [], socketInstance: {},
        projectTaskType: [], projectStatusStore: [], projectTaskStatus: []
    };
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

// Same add / modify / remove contract for the plain id-keyed lists.
describe.each([
    ['mutateRules', 'rawRules', '_id', false],
    ['mutateProjectRules', 'projectRawRules', '_id', true],
    ['mutateCompanies', 'companies', '_id', true],
    ['mutateTeams', 'teams', '_id', true],
    ['mutateTaskType', 'taskType', '_id', true],
    ['mutateTaskStatus', 'taskStatus', '_id', true],
    ['setProjectTaskTypeArray', 'projectTaskType', '_id', true],
    ['setProjectStatus', 'projectStatusStore', '_id', true],
    ['setProjectTaskStatusArray', 'projectTaskStatus', '_id', true],
    ['mutateProjectTabComponents', 'projectTabComponents', '_id', false],
    ['mutateFinalCustomFields', 'finalCustomFields', '_id', true],
    ['mutateFileExtentions', 'fileExtentions', 'name', true],
    ['mutateCompanyPriority', 'companyPriority', 'value', true]
])('%s keeps %s in sync', (fn, key, idKey, dedupes) => {
    const item = (id, extra = {}) => ({ [idKey]: id, label: `item ${id}`, ...extra });

    it('lists an added entry', () => {
        m[fn](state, { op: 'added', data: item('a') });
        expect(state[key]).toEqual([item('a')]);
    });

    it('replaces an entry on modify and ignores an unknown one', () => {
        state[key] = [item('a'), item('b')];
        m[fn](state, { op: 'modified', data: item('b', { label: 'renamed' }) });
        m[fn](state, { op: 'modified', data: item('zzz') });
        expect(state[key].map((x) => x.label)).toEqual(['item a', 'renamed']);
        expect(state[key]).toHaveLength(2);
    });

    it('drops a removed entry and ignores an unknown one', () => {
        state[key] = [item('a'), item('b')];
        m[fn](state, { op: 'removed', data: item('a') });
        m[fn](state, { op: 'removed', data: item('zzz') });
        expect(state[key]).toEqual([item('b')]);
    });

    it('ignores an unknown op', () => {
        state[key] = [item('a')];
        m[fn](state, { op: 'whatever', data: item('b') });
        expect(state[key]).toEqual([item('a')]);
    });

    if (dedupes) {
        it('does not list the same entry twice when it is added again', () => {
            if (fn === 'mutateTeams') return;
            m[fn](state, { op: 'added', data: item('a') });
            m[fn](state, { op: 'added', data: item('a', { label: 'again' }) });
            expect(state[key]).toEqual([item('a')]);
        });
    }
});

describe('rules', () => {
    it('mutateProjectRules clears every project rule on "delete"', () => {
        state.projectRawRules = [{ _id: 1 }, { _id: 2 }];
        m.mutateProjectRules(state, { op: 'delete' });
        expect(state.projectRawRules).toEqual([]);
    });

    const parent = { _id: 'p', isParent: true, name: 'Task Rules', key: 'task_rules' };
    const child = { _id: 'c', isParent: false, parentId: 'p', name: 'Can  Edit  Task' };

    // Children are looked up by parent.key only, so a parent keyed by its name loses them.
    it.fails('mutateArrangedRules keeps children of a parent that has no explicit key', () => {
        m.mutateArrangedRules(state, [{ _id: 'p', isParent: true, name: 'Task Rules' }, child]);
        expect(state.rules.task_rules.can_edit_task).toEqual(child);
    });

    it('mutateArrangedRules nests child rules under their parent key, defaulting child keys from names', () => {
        m.mutateArrangedRules(state, [child, parent]);
        expect(Object.keys(state.rules)).toEqual(['task_rules']);
        expect(state.rules.task_rules.can_edit_task).toEqual(child);
    });

    it('mutateArrangedRules prefers an explicit key over the name', () => {
        m.mutateArrangedRules(state, [{ ...parent, key: 'tasks' }, { ...child, key: 'edit' }]);
        expect(state.rules.tasks.edit).toBeDefined();
        expect(state.rules.tasks.can_edit_task).toBeUndefined();
    });

    it('mutateArrangedRules skips an orphan rule without losing the others', () => {
        m.mutateArrangedRules(state, [parent, { _id: 'x', isParent: false, parentId: 'ghost', name: 'Orphan' }, child]);
        expect(Object.keys(state.rules.task_rules)).toContain('can_edit_task');
        expect(Object.keys(state.rules.task_rules)).not.toContain('orphan');
    });

    it('mutateArrangedRules leaves previous rules alone for non-list input', () => {
        state.rules = { keep: true };
        m.mutateArrangedRules(state, undefined);
        expect(state.rules).toEqual({ keep: true });
    });

    it('mutateArrangeProjectRules nests rules on added/modified only', () => {
        m.mutateArrangeProjectRules(state, { op: 'added', data: [child, { ...parent, key: 'tasks' }] });
        expect(state.projectRules.tasks.can_edit_task).toEqual(child);

        m.mutateArrangeProjectRules(state, { op: 'removed', data: [] });
        expect(state.projectRules.tasks).toBeDefined();
    });

    it('mutateArrangeProjectRules ignores a child whose parent has no key and orphans', () => {
        m.mutateArrangeProjectRules(state, { op: 'modified', data: [{ ...parent, key: 'tasks' }, { _id: 'o', isParent: false, parentId: 'none', name: 'Lost' }] });
        expect(Object.keys(state.projectRules.tasks)).not.toContain('lost');
    });

    it('mutateArrangeProjectRules survives missing data', () => {
        state.projectRules = { keep: 1 };
        m.mutateArrangeProjectRules(state, { op: 'added', data: undefined });
        expect(state.projectRules).toEqual({ keep: 1 });
    });
});

describe('roles', () => {
    const roles = [{ key: 1, name: 'Owner' }, { key: 2, name: 'Admin' }, { key: 3, name: 'Member' }];

    it('hides the owner role from assignable roles', () => {
        m.mutateRoles(state, { op: 'added', data: roles });
        expect(state.roles).toHaveLength(3);
        expect(state.withoutOwnerRoles.map((r) => r.name)).toEqual(['Admin', 'Member']);
    });

    it('recomputes assignable roles on modify and empties both on remove', () => {
        m.mutateRoles(state, { op: 'modified', data: roles.slice(0, 2) });
        expect(state.withoutOwnerRoles).toEqual([{ key: 2, name: 'Admin' }]);
        m.mutateRoles(state, { op: 'removed', data: roles });
        expect(state.roles).toEqual([]);
        expect(state.withoutOwnerRoles).toEqual([]);
    });
});

describe('company users', () => {
    it('adds and merges updates into an existing member', () => {
        m.mutateCompanyUsers(state, { op: 'added', data: { _id: 'u1', name: 'Ann', email: 'a@x.io' } });
        m.mutateCompanyUsers(state, { op: 'modified', data: { _id: 'u1', name: 'Anna' } });
        expect(state.companyUsers).toEqual([{ _id: 'u1', name: 'Anna', email: 'a@x.io' }]);
    });

    it('removes a member and ignores unknown ones', () => {
        state.companyUsers = [{ _id: 'u1' }, { _id: 'u2' }];
        m.mutateCompanyUsers(state, { op: 'removed', data: { _id: 'u1' } });
        m.mutateCompanyUsers(state, { op: 'removed', data: { _id: 'nope' } });
        expect(state.companyUsers).toEqual([{ _id: 'u2' }]);
    });

    it('remembers the signed-in member and the company owner', () => {
        m.mutateCompanyUsers(state, { op: 'added', data: { _id: 'u1', isCurrentUser: true, roleType: 2 } });
        m.mutateCompanyUsers(state, { op: 'added', data: { _id: 'u2', roleType: 1 } });
        expect(state.companyUserDetail._id).toBe('u1');
        expect(state.companyOwnerDetail._id).toBe('u2');
    });
});

describe('single-value settings', () => {
    it.each([
        ['mutateCompanyUserStatus', 'companyUserStatus', [], [{ k: 1 }]],
        ['mutateDesignations', 'designations', [], [{ n: 'Dev' }]],
        ['mutateRestrictedExtensions', 'restrictedExtensions', [], ['exe']],
        ['mutateNotificationSettings', 'notificationSettings', {}, { email: true }],
        ['mutateProjectMilestoneWeeklyRange', 'milestoneweeklyrange', '', 'mon-fri']
    ])('%s stores added/modified data and resets on remove', (fn, key, empty, data) => {
        m[fn](state, { op: 'added', data });
        expect(state[key]).toEqual(data);
        m[fn](state, { op: 'modified', data: empty });
        expect(state[key]).toEqual(empty);
        m[fn](state, { op: 'modified', data });
        m[fn](state, { op: 'removed' });
        expect(state[key]).toEqual(empty);
    });

    it('designations fall back to an empty list when added without data', () => {
        m.mutateDesignations(state, { op: 'added', data: undefined });
        expect(state.designations).toEqual([]);
    });

    it('company date format takes the first server entry and resets to {} on remove', () => {
        m.mutateCompanyDateFormat(state, { op: 'added', data: [{ f: 'DD/MM' }, { f: 'x' }] });
        expect(state.companyDateFormat).toEqual({ f: 'DD/MM' });
        m.mutateCompanyDateFormat(state, { op: 'modified', data: [{ f: 'MM/DD' }] });
        expect(state.companyDateFormat).toEqual({ f: 'MM/DD' });
        m.mutateCompanyDateFormat(state, { op: 'removed' });
        expect(state.companyDateFormat).toEqual({});
    });

    it.each([
        ['mutateSelectedCompany', 'selectedCompanyId', 'c9'],
        ['mutateCategory', 'category', [{ n: 'a' }]],
        ['mutateCustomFields', 'customFields', [{ n: 'f' }]],
        ['mutateTimeTrackerDownload', 'TimeTracker', [{ id: 1 }]],
        ['setplanFeatureDisplay', 'planFeatureDisplay', [{ p: 1 }]],
        ['mutateSocketInstance', 'socketInstance', { id: 's' }]
    ])('%s replaces the value outright', (fn, key, value) => {
        m[fn](state, value);
        expect(state[key]).toEqual(value);
    });
});

describe('initial loads', () => {
    it('inital replaces the whole list for skills, file extensions, custom fields, priorities, currencies, milestones', () => {
        m.mutateProjectSkills(state, { op: 'inital', data: [{ slug: 'a' }] });
        m.mutateProjectSkills(state, { op: 'inital', data: undefined });
        expect(state.projectSkills).toEqual([]);

        m.mutateFileExtentions(state, { op: 'inital', data: [{ name: 'png' }] });
        expect(state.fileExtentions).toEqual([{ name: 'png' }]);

        m.mutateFinalCustomFields(state, { op: 'inital', data: [{ _id: 1 }] });
        expect(state.finalCustomFields).toEqual([{ _id: 1 }]);

        const src = [{ value: 'HIGH' }];
        m.mutateCompanyPriority(state, { op: 'inital', data: src });
        expect(state.companyPriority).toEqual(src);
        expect(state.companyPriority).not.toBe(src);
    });

    it('a skill rename is matched on key, not slug', () => {
        state.projectSkills = [{ key: 'k1', slug: 'old', name: 'Old' }];
        m.mutateProjectSkills(state, { op: 'modified', data: { key: 'k1', slug: 'old', name: 'New' } });
        expect(state.projectSkills[0].name).toBe('New');
    });

    it('a duplicate skill slug is not listed twice', () => {
        state.projectSkills = [{ key: 'k1', slug: 's' }];
        m.mutateProjectSkills(state, { op: 'added', data: { key: 'k2', slug: 's' } });
        expect(state.projectSkills).toHaveLength(1);
    });
});

describe('task types, task statuses and project statuses', () => {
    it('modified task type can swap to a new id', () => {
        state.taskType = [{ _id: 'tmp', name: 'Bug' }];
        m.mutateTaskType(state, { op: 'modified', data: { _id: 'tmp', name: 'Bug' }, newId: 'real' });
        expect(state.taskType).toEqual([{ _id: 'real', name: 'Bug' }]);
    });

    it('modified task type flags unsaved rows with isShowSave and wins over newId', () => {
        state.taskType = [{ _id: 'a' }];
        m.mutateTaskType(state, { op: 'modified', data: { _id: 'a' }, isShowSave: true, newId: 'z' });
        expect(state.taskType).toEqual([{ _id: 'a', isShowSave: true }]);
    });

    it('task status, project task type/status/task status accept a replacement id', () => {
        const cases = [['mutateTaskStatus', 'taskStatus'], ['setProjectTaskTypeArray', 'projectTaskType'], ['setProjectStatus', 'projectStatusStore'], ['setProjectTaskStatusArray', 'projectTaskStatus']];
        for (const [fn, key] of cases) {
            state[key] = [{ _id: 'tmp' }];
            m[fn](state, { op: 'modified', data: { _id: 'tmp', n: 1 }, newId: 'real' });
            expect(state[key]).toEqual([{ _id: 'real', n: 1 }]);
        }
    });

    it('project status modify flags isShowSave and swaps ids', () => {
        state.projectStaus = [{ _id: 'a' }];
        m.mutateProjectStatus(state, { op: 'added', data: { _id: 'a' } });
        expect(state.projectStaus).toHaveLength(1);
        m.mutateProjectStatus(state, { op: 'modified', data: { _id: 'a' }, isShowSave: true });
        expect(state.projectStaus[0]).toEqual({ _id: 'a', isShowSave: true });
        m.mutateProjectStatus(state, { op: 'modified', data: { _id: 'a' }, newId: 'b' });
        expect(state.projectStaus[0]._id).toBe('b');
        m.mutateProjectStatus(state, { op: 'removed', data: { _id: 'b' } });
        m.mutateProjectStatus(state, { op: 'removed', data: { _id: 'nope' } });
        expect(state.projectStaus).toEqual([]);
    });

    // projectStaus[-1] is written for an unknown id, leaving a stray non-index property on the array.
    it.fails('project status modify of an unknown id does not change the list', () => {
        state.projectStaus = [{ _id: 'a' }];
        m.mutateProjectStatus(state, { op: 'modified', data: { _id: 'ghost' } });
        expect(Object.keys(state.projectStaus)).toEqual(['0']);
    });
});

describe('milestone statuses', () => {
    it('loads, adds without duplicates, replaces and removes', () => {
        m.mutateProjectMilestoneStatus(state, { op: 'inital', data: [{ value: 'OPEN', isCount: 1 }] });
        m.mutateProjectMilestoneStatus(state, { op: 'added', data: { value: 'OPEN', isCount: 9 } });
        m.mutateProjectMilestoneStatus(state, { op: 'added', data: { value: 'PAID', isCount: 0 } });
        expect(state.projectMilestone.map((x) => x.value)).toEqual(['OPEN', 'PAID']);
        m.mutateProjectMilestoneStatus(state, { op: 'modified', data: { value: 'PAID', isCount: 5 } });
        expect(state.projectMilestone[1].isCount).toBe(5);
        m.mutateProjectMilestoneStatus(state, { op: 'removed', data: { value: 'OPEN' } });
        m.mutateProjectMilestoneStatus(state, { op: 'removed', data: { value: 'NOPE' } });
        m.mutateProjectMilestoneStatus(state, { op: 'modified', data: { value: 'NOPE' } });
        expect(state.projectMilestone.map((x) => x.value)).toEqual(['PAID']);
    });

    it('increments and decrements the count of an adjustable status', () => {
        state.projectMilestone = [{ value: 'OPEN', isCount: 2 }];
        m.mutateProjectMilestoneStatus(state, { op: 'modified', data: { value: 'OPEN' }, countType: 'increment' });
        expect(state.projectMilestone[0].isCount).toBe(3);
        m.mutateProjectMilestoneStatus(state, { op: 'modified', data: { value: 'OPEN' }, countType: 'decrement' });
        m.mutateProjectMilestoneStatus(state, { op: 'modified', data: { value: 'OPEN' }, countType: 'decrement' });
        expect(state.projectMilestone[0].isCount).toBe(1);
    });

    it.each(['CANCELLED', 'RELEASED', 'FUNDED', 'REFUNDED'])('%s always counts 0', (value) => {
        state.projectMilestone = [{ value, isCount: 4 }];
        m.mutateProjectMilestoneStatus(state, { op: 'modified', data: { value }, countType: 'increment' });
        expect(state.projectMilestone[0].isCount).toBe(0);
    });
});

describe('currencies', () => {
    it('adjusts the usage count on modify with a countType, otherwise replaces', () => {
        m.setCurrencyArray(state, { op: 'inital', data: [{ _id: 'usd', count: 1 }] });
        m.setCurrencyArray(state, { op: 'added', data: { _id: 'usd', count: 7 } });
        m.setCurrencyArray(state, { op: 'added', data: { _id: 'eur', count: 0 } });
        expect(state.currencyArray).toHaveLength(2);

        m.setCurrencyArray(state, { op: 'modified', data: { _id: 'usd' }, countType: 'increment' });
        expect(state.currencyArray[0].count).toBe(2);
        m.setCurrencyArray(state, { op: 'modified', data: { _id: 'usd' }, countType: 'decrement' });
        expect(state.currencyArray[0].count).toBe(1);
        m.setCurrencyArray(state, { op: 'modified', data: { _id: 'eur', count: 3, symbol: 'E' } });
        expect(state.currencyArray[1]).toEqual({ _id: 'eur', count: 3, symbol: 'E' });
        m.setCurrencyArray(state, { op: 'modified', data: { _id: 'ghost' } });

        m.setCurrencyArray(state, { op: 'removed', data: { _id: 'usd' } });
        m.setCurrencyArray(state, { op: 'removed', data: { _id: 'ghost' } });
        expect(state.currencyArray.map((c) => c._id)).toEqual(['eur']);
    });
});

describe('team added twice', () => {
    it('replaces the earlier copy instead of duplicating', () => {
        m.mutateTeams(state, { op: 'added', data: { _id: 't', n: 1 } });
        m.mutateTeams(state, { op: 'added', data: { _id: 't', n: 2 } });
        expect(state.teams).toEqual([{ _id: 't', n: 2 }]);
    });
});

describe('whole-document status templates', () => {
    it.each([
        ['mutateTaskStatusArray', 'TaskStatusArray'],
        ['setProjectStatusArray', 'projectStatusArray'],
        ['setTaskTypeArray', 'taskTypeArray']
    ])('%s takes added data and only modified data with the same id', (fn, key) => {
        m[fn](state, { op: 'added', data: { _id: 'a', v: 1 } });
        expect(state[key]).toEqual({ _id: 'a', v: 1 });
        m[fn](state, { op: 'modified', data: { _id: 'a', v: 2 } });
        expect(state[key].v).toBe(2);
        m[fn](state, { op: 'modified', data: { _id: 'other', v: 3 } });
        expect(state[key].v).toBe(2);
    });
});
