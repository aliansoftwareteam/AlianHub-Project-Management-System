/* Task 046 M2, slice E2: what the Everything page asks the server for. The server refuses an
   unknown key, so the page's own request builder is also what records the fixture the store is
   tested against (tests/everything-fixture.test.js). */
import { describe, expect, it } from 'vitest';
import {
    DEFAULT_SETTINGS, MODES, OPEN_STATUS_TYPES, PAGE_SIZE, baseRequest, boardColumns, cleanSettings, dropDecision, dueWindows, firstRequest,
    foldDueDays, groupRequest, groupsFrom, queryGroup, sameSettings, viewBody, viewPatch
} from '@/views/Everything/everythingRequest';

const KOLKATA_NOON = { now: new Date('2026-10-01T06:30:00.000Z'), timeZone: 'Asia/Kolkata' };
const settings = (over = {}) => ({ ...DEFAULT_SETTINGS, ...over });
const ME = '6f0000000000000000000001';

describe('saved settings', () => {
    it('start with done work hidden, subtasks and closed projects off, newest first', () => {
        expect(DEFAULT_SETTINGS).toMatchObject({ group: 'none', sortBy: 'updatedAt', sortDir: 'desc', showSubtasks: false, hideDone: true, includeClosed: false });
        expect(cleanSettings(null)).toEqual({ ...DEFAULT_SETTINGS });
        expect(cleanSettings('junk')).toEqual({ ...DEFAULT_SETTINGS });
    });

    it('keep only what the server would accept', () => {
        expect(cleanSettings({
            group: 'customField', sortBy: 'TaskName', sortDir: 'sideways', due: 'someday', hideDone: 'no', showSubtasks: true,
            status: ['Doing', 7, '', 'Doing', { $ne: null }], assignee: 'me', findQuery: [{ $match: {} }]
        })).toEqual({ ...DEFAULT_SETTINGS, showSubtasks: true, status: ['Doing'] });
    });

    it('give a due-date sort its own direction when none was saved', () => {
        expect(cleanSettings({ sortBy: 'DueDate' })).toMatchObject({ sortBy: 'DueDate', sortDir: 'asc' });
        expect(cleanSettings({ sortBy: 'DueDate', sortDir: 'desc' })).toMatchObject({ sortBy: 'DueDate', sortDir: 'desc' });
    });
});

describe('the base request', () => {
    it('hides done work by default and sends nothing it was not asked for', () => {
        expect(baseRequest(settings(), KOLKATA_NOON)).toEqual({
            filter: { statusType: OPEN_STATUS_TYPES },
            sort: { by: 'updatedAt', dir: 'desc' },
            includeSubtasks: false,
            includeClosedProjects: false,
            timezone: 'Asia/Kolkata'
        });
        expect(baseRequest(settings({ hideDone: false }), KOLKATA_NOON).filter).toEqual({});
    });

    it('sends each chosen filter, the search trimmed, and the toggles', () => {
        const request = baseRequest(settings({
            search: '  footer ', status: ['Doing'], assignee: [ME, 'unassigned'], priority: ['HIGH'], taskType: ['bug'], projectIds: ['6f0000000000000000000a01'],
            due: 'today', sortBy: 'DueDate', sortDir: 'asc', showSubtasks: true, includeClosed: true
        }), KOLKATA_NOON);
        expect(request).toEqual({
            filter: {
                status: ['Doing'], statusType: OPEN_STATUS_TYPES, assignee: [ME, 'unassigned'], priority: ['HIGH'],
                dueDate: { from: '2026-09-30T18:30:00.000Z', to: '2026-10-01T18:29:59.999Z' },
                taskType: ['bug'], search: 'footer', projectIds: ['6f0000000000000000000a01']
            },
            sort: { by: 'DueDate', dir: 'asc' },
            includeSubtasks: true,
            includeClosedProjects: true,
            timezone: 'Asia/Kolkata'
        });
    });

    it('asks for one page when nothing groups the rows, and for the counts alone when something does', () => {
        expect(firstRequest(settings(), KOLKATA_NOON)).toMatchObject({ limit: PAGE_SIZE });
        expect(firstRequest(settings(), KOLKATA_NOON)).not.toHaveProperty('group');
        expect(firstRequest(settings({ group: 'status' }), KOLKATA_NOON, 20)).toMatchObject({ group: 'status', limit: 1 });
    });
});

describe('due dates fold into the viewer\'s days', () => {
    const days = [{ key: null, count: 4 }, { key: '2026-09-30', count: 1 }, { key: '2026-10-01', count: 2 }, { key: '2026-10-02', count: 3 }, { key: '2026-10-04', count: 5 }];
    const late = new Date('2026-10-01T20:00:00.000Z');

    it('reads the same day counts differently on each side of midnight', () => {
        expect(foldDueDays(days, late, 'UTC')).toEqual([{ id: 'overdue', count: 1 }, { id: 'today', count: 2 }, { id: 'week', count: 3 }, { id: 'later', count: 5 }, { id: 'none', count: 4 }]);
        expect(foldDueDays(days, late, 'Asia/Kolkata')).toEqual([{ id: 'overdue', count: 3 }, { id: 'today', count: 3 }, { id: 'later', count: 5 }, { id: 'none', count: 4 }]);
        expect(foldDueDays(days, late, 'America/Los_Angeles')).toEqual(foldDueDays(days, late, 'UTC'));
    });

    it('asks for each bucket between that timezone\'s midnights', () => {
        expect(dueWindows(late, 'Asia/Kolkata').filters).toEqual({
            overdue: { to: '2026-10-01T18:29:59.999Z' },
            today: { from: '2026-10-01T18:30:00.000Z', to: '2026-10-02T18:29:59.999Z' },
            week: { from: '2026-10-02T18:30:00.000Z', to: '2026-10-03T18:29:59.999Z' },
            later: { from: '2026-10-03T18:30:00.000Z' },
            none: { none: true }
        });
        expect(dueWindows(late, 'UTC').filters.today).toEqual({ from: '2026-10-01T00:00:00.000Z', to: '2026-10-01T23:59:59.999Z' });
    });

    it('has no "this week" left on a Saturday, as in the project List', () => {
        const saturday = dueWindows(new Date('2026-10-03T06:30:00.000Z'), 'Asia/Kolkata');
        expect(saturday.filters.week).toBeUndefined();
        expect(saturday.filters.later).toEqual({ from: '2026-10-03T18:30:00.000Z' });
        expect(foldDueDays([{ key: '2026-10-04', count: 1 }], new Date('2026-10-03T06:30:00.000Z'), 'Asia/Kolkata')).toEqual([{ id: 'later', count: 1 }]);
    });

    it('keeps a day twenty-five hours long when the clocks go back', () => {
        const { today } = dueWindows(new Date('2026-11-01T12:00:00.000Z'), 'America/New_York').filters;
        expect(today).toEqual({ from: '2026-11-01T04:00:00.000Z', to: '2026-11-02T04:59:59.999Z' });
    });

    it('drops a saved bucket that does not exist today instead of sending a filter the server refuses', () => {
        const saturday = { now: new Date('2026-10-03T06:30:00.000Z'), timeZone: 'Asia/Kolkata' };
        expect(baseRequest(settings({ due: 'week' }), saturday).filter).not.toHaveProperty('dueDate');
    });
});

describe('groups, each with the filter that asks for its rows', () => {
    const idsOf = (groups) => groups.map((group) => group.id);

    it('is one group holding the total when nothing groups the rows', () => {
        expect(groupsFrom([{ key: null, count: 5 }], settings(), KOLKATA_NOON)).toEqual([{ id: 'all', key: null, count: 5, filter: {} }]);
        expect(groupsFrom([{ key: null, count: 0 }], settings(), KOLKATA_NOON)).toEqual([{ id: 'all', key: null, count: 0, filter: {} }]);
    });

    it('groups by status name, project and priority, and leaves out an empty group', () => {
        expect(groupsFrom([{ key: 'Doing', count: 3 }, { key: 'To Do', count: 0 }], settings({ group: 'status' }), KOLKATA_NOON))
            .toEqual([{ id: 'status:Doing', key: 'Doing', count: 3, filter: { status: ['Doing'] } }]);
        expect(groupsFrom([{ key: 'p1', count: 2 }], settings({ group: 'project' }), KOLKATA_NOON))
            .toEqual([{ id: 'project:p1', key: 'p1', count: 2, filter: { projectIds: ['p1'] } }]);
        const priorities = groupsFrom([{ key: 'CUSTOM', count: 1 }, { key: 'LOW', count: 1 }, { key: 'HIGH', count: 1 }, { key: 'URGENT', count: 1 }], settings({ group: 'priority' }), KOLKATA_NOON);
        expect(idsOf(priorities)).toEqual(['priority:URGENT', 'priority:HIGH', 'priority:LOW', 'priority:CUSTOM']);
        expect(priorities[1].filter).toEqual({ priority: ['HIGH'] });
    });

    it('puts nobody\'s tasks last when grouping by assignee', () => {
        const groups = groupsFrom([{ key: null, count: 2 }, { key: 'u1', count: 3 }, { key: 'u2', count: 1 }], settings({ group: 'assignee' }), KOLKATA_NOON);
        expect(idsOf(groups)).toEqual(['assignee:u1', 'assignee:u2', 'assignee:unassigned']);
        expect(groups[2]).toEqual({ id: 'assignee:unassigned', key: null, count: 2, filter: { assignee: ['unassigned'] } });
    });

    it('shows only the people asked for when an assignee filter is on', () => {
        const groups = groupsFrom([{ key: null, count: 2 }, { key: 'u1', count: 3 }, { key: 'u2', count: 1 }], settings({ group: 'assignee', assignee: ['u1'] }), KOLKATA_NOON);
        expect(idsOf(groups)).toEqual(['assignee:u1']);
    });

    it('folds days into buckets and narrows each to the due filter already chosen', () => {
        const counts = [{ key: null, count: 1 }, { key: '2026-09-28', count: 1 }, { key: '2026-10-01', count: 1 }, { key: '2026-10-03', count: 1 }, { key: '2026-10-20', count: 1 }];
        const groups = groupsFrom(counts, settings({ group: 'dueDate' }), KOLKATA_NOON);
        expect(idsOf(groups)).toEqual(['dueDate:overdue', 'dueDate:today', 'dueDate:week', 'dueDate:later', 'dueDate:none']);
        expect(groups[2]).toEqual({ id: 'dueDate:week', key: 'week', count: 1, filter: { dueDate: { from: '2026-10-01T18:30:00.000Z', to: '2026-10-03T18:29:59.999Z' } } });
        expect(groups[4].filter).toEqual({ dueDate: { none: true } });

        const chosen = groupsFrom([{ key: '2026-10-01', count: 1 }], settings({ group: 'dueDate', due: 'today' }), KOLKATA_NOON);
        expect(chosen).toEqual([{ id: 'dueDate:today', key: 'today', count: 1, filter: { dueDate: { from: '2026-09-30T18:30:00.000Z', to: '2026-10-01T18:29:59.999Z' } } }]);
    });
});

describe('a page inside a group', () => {
    const base = baseRequest(settings({ status: ['Doing', 'To Do'] }), KOLKATA_NOON);

    it('is the same query narrowed to the group, never a different one', () => {
        const request = groupRequest(base, { status: ['Doing'] }, { limit: 20 });
        expect(request).toEqual({ ...base, filter: { status: ['Doing'], statusType: OPEN_STATUS_TYPES }, limit: 20 });
        expect(request).not.toHaveProperty('cursor');
        expect(request).not.toHaveProperty('group');
        expect(base.filter.status).toEqual(['Doing', 'To Do']);
    });

    it('carries the cursor of the page before it', () => {
        expect(groupRequest(base, {}, { cursor: 'abc.def', limit: 20 })).toMatchObject({ cursor: 'abc.def', limit: 20 });
        expect(groupRequest(base, {})).toMatchObject({ limit: PAGE_SIZE });
    });
});

describe('modes', () => {
    it('are list, board and table, kept with the other settings', () => {
        expect(MODES).toEqual(['list', 'board', 'table']);
        expect(DEFAULT_SETTINGS.mode).toBe('list');
        expect(cleanSettings({ mode: 'board' }).mode).toBe('board');
        expect(cleanSettings({ mode: 'gantt' }).mode).toBe('list');
    });

    it('are never sent to the server: the board asks for statuses, whatever the list is grouped by', () => {
        const board = settings({ mode: 'board', group: 'project' });
        expect(queryGroup(board)).toBe('status');
        expect(firstRequest(board, KOLKATA_NOON)).toMatchObject({ group: 'status', limit: 1 });
        expect(firstRequest(board, KOLKATA_NOON)).not.toHaveProperty('mode');
        expect(queryGroup(settings({ mode: 'table', group: 'project' }))).toBe('project');
        expect(groupsFrom([{ key: 'Doing', count: 3 }], board, KOLKATA_NOON)).toEqual([{ id: 'status:Doing', key: 'Doing', count: 3, filter: { status: ['Doing'] } }]);
    });
});

describe('the board\'s columns', () => {
    const STATUSES = [
        { name: 'Done', type: 'close' }, { name: 'Doing', type: 'active' }, { name: 'To Do', type: 'default_active' },
        { name: 'Waiting', type: 'active' }, { name: 'Doing', type: 'active' }, { name: 'Shipped', type: 'done' }
    ];
    const counted = [{ id: 'status:Doing', key: 'Doing', count: 3, filter: { status: ['Doing'] } }];
    const names = (columns) => columns.map((column) => `${column.key} ${column.count}`);

    it('merge by status name, in the order to do, active, done, and include the statuses no task holds yet', () => {
        expect(names(boardColumns(counted, STATUSES, settings({ mode: 'board', hideDone: false })))).toEqual(['To Do 0', 'Doing 3', 'Waiting 0', 'Done 0', 'Shipped 0']);
    });

    it('leave out the closed statuses while done work is hidden, and anything outside a status filter', () => {
        expect(names(boardColumns(counted, STATUSES, settings({ mode: 'board' })))).toEqual(['To Do 0', 'Doing 3', 'Waiting 0']);
        expect(names(boardColumns(counted, STATUSES, settings({ mode: 'board', status: ['Doing', 'Waiting'] })))).toEqual(['Doing 3', 'Waiting 0']);
    });

    it('give an empty column the filter that would ask for its rows', () => {
        const waiting = boardColumns(counted, STATUSES, settings({ mode: 'board' })).find((column) => column.key === 'Waiting');
        expect(waiting).toEqual({ id: 'status:Waiting', key: 'Waiting', count: 0, filter: { status: ['Waiting'] } });
    });

    it('still show a counted status the project list does not know', () => {
        expect(names(boardColumns(counted, [], settings({ mode: 'board' })))).toEqual(['Doing 3']);
    });
});

describe('dropping a card on a column', () => {
    const project = { edit: { status: true }, taskStatusData: [{ key: 1, name: 'To Do', type: 'default_active' }, { key: 4, name: 'Waiting on a supplier', type: 'active' }] };
    const task = { _id: 't1', status: { text: 'To Do' }, statusKey: 1 };

    it('is allowed when the task\'s own project has a status with that exact name', () => {
        expect(dropDecision(task, project, 'Waiting on a supplier')).toEqual({ allowed: true, status: project.taskStatusData[1] });
    });

    it('is refused, with the reason, when the project has no such status or the role may not change status', () => {
        expect(dropDecision(task, project, 'Doing')).toEqual({ allowed: false, reason: 'no_status' });
        expect(dropDecision(task, project, 'waiting on a supplier')).toEqual({ allowed: false, reason: 'no_status' });
        expect(dropDecision(task, { ...project, edit: { status: false } }, 'Waiting on a supplier')).toEqual({ allowed: false, reason: 'no_permission' });
        expect(dropDecision(task, null, 'Waiting on a supplier')).toEqual({ allowed: false, reason: 'no_permission' });
    });

    it('changes nothing when the card is dropped where it already is', () => {
        expect(dropDecision(task, project, 'To Do')).toEqual({ allowed: false, reason: 'same' });
    });
});

describe('a saved view', () => {
    it('is sent as a name and the cleaned settings, mode included', () => {
        const body = viewBody('My board', { ...settings({ mode: 'board', status: ['Doing'] }), findQuery: [] });
        expect(body).toEqual({ name: 'My board', settings: settings({ mode: 'board', status: ['Doing'] }) });
        expect(viewPatch({ name: 'Renamed' })).toEqual({ name: 'Renamed' });
        expect(viewPatch({ isDefault: false })).toEqual({ isDefault: false });
        expect(viewPatch({ settings: settings({ mode: 'table' }) })).toEqual({ settings: settings({ mode: 'table' }) });
    });

    it('is unchanged or changed by comparing what would be saved', () => {
        expect(sameSettings(settings(), { ...settings(), unknown: 1 })).toBe(true);
        expect(sameSettings(settings(), settings({ mode: 'board' }))).toBe(false);
        expect(sameSettings(settings({ status: ['A'] }), settings({ status: ['A'] }))).toBe(true);
    });
});
