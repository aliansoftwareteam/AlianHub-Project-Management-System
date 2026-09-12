/* The List view's parent rows used to read "0/N" until they were expanded, because the
   closed count only ever looked at subtaskArray, which the list query never returns. */
const fs = require('fs');
const path = require('path');
const P = require('../frontend/src/views/Projects/ListView/subtaskProgress');
const { validatePipeline, QueryRefused } = require('../Modules/Tasks/helpers/taskQueryGuard');

const parent = (overrides) => Object.assign({
    _id: 'p1',
    TaskKey: 'AP-410',
    isParentTask: true,
    statusType: 'active',
    subTasks: 13,
}, overrides);

const sub = (statusType) => ({ _id: Math.random().toString(36).slice(2), statusType, deletedStatusKey: 0 });
const subs = (closed, open) => [...Array(closed).fill(0).map(() => sub('close')), ...Array(open).fill(0).map(() => sub('active'))];

/* The pill in TaskDetailPanel.vue (subtaskCompletion) is the number the row may never
   contradict, so its math is mirrored here as the reference. */
const detailPanelPill = (task, counts) => {
    const valid = (task.subtaskArray || []).filter((s) => s && (s.deletedStatusKey === 0 || s.deletedStatusKey === undefined));
    const loadedCompleted = valid.filter((s) => (s?.status?.type || s?.statusType) === 'close').length;
    const trueTotal = Math.max(valid.length, Number(task.subTasks) || 0, (counts && counts.total) || 0);
    if (valid.length >= trueTotal) return { total: valid.length, completed: loadedCompleted };
    if (counts && counts.total) return { total: counts.total, completed: counts.completed };
    return { total: trueTotal, completed: loadedCompleted };
};

describe('a collapsed parent reports the true closed count', () => {
    test('AP-410: 13 of 13 closed reads 13/13 with no subtaskArray loaded', () => {
        const row = parent();
        expect(P.subtaskProgress(row, { total: 13, completed: 13 })).toEqual({ done: 13, total: 13 });
    });

    test('a partly finished parent reads its real numerator, not 0', () => {
        expect(P.subtaskProgress(parent({ subTasks: 9 }), { total: 9, completed: 7 })).toEqual({ done: 7, total: 9 });
    });

    test('no fraction is shown at all until the aggregate lands, so 0/N is never rendered', () => {
        expect(P.subtaskProgress(parent(), null)).toBeNull();
        expect(P.subtaskTotal(parent(), null)).toBe(13);
    });

    test('a genuinely unfinished parent still reads 0/N once counted', () => {
        expect(P.subtaskProgress(parent({ subTasks: 4 }), { total: 4, completed: 0 })).toEqual({ done: 0, total: 4 });
    });
});

describe('collapsed, expanded and the detail panel agree', () => {
    const cases = [
        ['all closed', 13, 13, 0],
        ['none closed', 5, 0, 5],
        ['partly closed', 9, 7, 2],
        ['single subtask', 1, 1, 0],
    ];

    test.each(cases)('%s: the same parent reads alike collapsed and expanded', (_name, total, closed, open) => {
        const counts = { total, completed: closed };
        const collapsed = P.subtaskProgress(parent({ subTasks: total }), counts);
        const expanded = P.subtaskProgress(parent({ subTasks: total, subtaskArray: subs(closed, open) }), counts);
        expect(collapsed).toEqual({ done: closed, total });
        expect(expanded).toEqual(collapsed);
    });

    test.each(cases)('%s: neither disagrees with the detail panel pill', (_name, total, closed, open) => {
        const counts = { total, completed: closed };
        const loaded = parent({ subTasks: total, subtaskArray: subs(closed, open) });
        const pill = detailPanelPill(loaded, counts);
        expect(P.subtaskProgress(parent({ subTasks: total }), counts)).toEqual({ done: pill.completed, total: pill.total });
        expect(P.subtaskProgress(loaded, counts)).toEqual({ done: pill.completed, total: pill.total });
    });

    test('closing a subtask in an expanded row moves the numerator live', () => {
        const stale = { total: 13, completed: 12 };
        const row = parent({ subtaskArray: subs(13, 0) });
        expect(P.subtaskProgress(row, stale)).toEqual({ done: 13, total: 13 });
    });

    test('a truncated expand keeps the aggregate, so the fraction never shrinks to the page size', () => {
        const row = parent({ subTasks: 40, subtaskArray: subs(30, 5) });
        expect(P.subtaskProgress(row, { total: 40, completed: 38 })).toEqual({ done: 38, total: 40 });
        expect(detailPanelPill(row, { total: 40, completed: 38 })).toEqual({ total: 40, completed: 38 });
    });

    test('the aggregate outranks a drifted subTasks counter', () => {
        expect(P.subtaskProgress(parent({ subTasks: 15 }), { total: 13, completed: 13 })).toEqual({ done: 13, total: 13 });
    });

    test('archived subtasks are left out of both halves of the fraction', () => {
        const row = parent({ subTasks: 2, subtaskArray: [sub('close'), { _id: 'x', statusType: 'close', deletedStatusKey: 2 }] });
        expect(P.subtaskProgress(row, { total: 1, completed: 1 })).toEqual({ done: 1, total: 1 });
    });

    test('a parent with no subtasks shows nothing', () => {
        expect(P.subtaskProgress(parent({ subTasks: 0 }), null)).toBeNull();
        expect(P.subtaskProgress({ _id: 'p', isParentTask: true }, null)).toBeNull();
    });
});

describe('the progress aggregate the rows are counted from', () => {
    const query = P.progressQuery(['p1', 'p2']);

    test('it groups closed children by parent id', () => {
        expect(query[0].$match.ParentTaskId).toEqual({ $in: ['p1', 'p2'] });
        expect(query[0].$match.deletedStatusKey).toEqual({ $in: [0, undefined] });
        expect(query[1].$group._id).toBe('$ParentTaskId');
        expect(query[1].$group.completed.$sum.$cond[0]).toEqual({ $eq: ['$statusType', 'close'] });
    });

    test('the backend task-query guard accepts it', () => {
        expect(() => validatePipeline(JSON.parse(JSON.stringify(query)))).not.toThrow();
    });

    test('a $lookup into tasks would have been refused, which is why it is a $group', () => {
        const join = [{ $lookup: { from: 'tasks', localField: '_id', foreignField: 'ParentTaskId', as: 'subs' } }];
        expect(() => validatePipeline(join)).toThrow(QueryRefused);
    });

    test('aggregate rows index by parent id', () => {
        expect(P.indexProgress([{ _id: 'p1', total: 13, completed: 13 }, { _id: 'p2', total: 4, completed: 1 }]))
            .toEqual({ p1: { total: 13, completed: 13 }, p2: { total: 4, completed: 1 } });
        expect(P.indexProgress(null)).toEqual({});
    });

    test('the fetch re-runs when a group gains parents, not when rows are merely reordered', () => {
        const a = parent({ _id: 'p1' });
        const b = parent({ _id: 'p2', subTasks: 4 });
        expect(P.progressSignature([a, b])).toBe(P.progressSignature([b, a]));
        expect(P.progressSignature([a])).not.toBe(P.progressSignature([a, b]));
        expect(P.progressSignature([parent({ subTasks: 13 })])).not.toBe(P.progressSignature([parent({ subTasks: 14 })]));
    });
});

describe('the expand toggle reaches groups opened after it was flipped', () => {
    const rows = [parent({ _id: 'p1' }), parent({ _id: 'p2', subTasks: 4 }), { _id: 'p3', isParentTask: true, subTasks: 0 }];

    test('rows that land after the toggle are expanded', () => {
        expect(P.pendingExpandIds(rows, [])).toEqual(['p1', 'p2']);
    });

    test('a parent with no subtasks is never expanded', () => {
        expect(P.pendingExpandIds(rows, [])).not.toContain('p3');
    });

    test('a row the user collapsed by hand is not reopened when the group reloads', () => {
        expect(P.pendingExpandIds(rows, ['p1', 'p2'])).toEqual([]);
        expect(P.pendingExpandIds([...rows, parent({ _id: 'p4', subTasks: 2 })], ['p1', 'p2'])).toEqual(['p4']);
    });

    test('an empty group asks for nothing', () => {
        expect(P.pendingExpandIds([], [])).toEqual([]);
        expect(P.pendingExpandIds(null, null)).toEqual([]);
    });
});

describe('the List view is wired to all of this', () => {
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    const group = read('frontend/src/views/Projects/ListView/ListGroup.vue');
    const row = read('frontend/src/views/Projects/ListView/ListRow.vue');

    test('the expand toggle watches rows as well, and runs immediately', () => {
        const watcher = group.match(/watch\(\[taskCollapsed, rows\][\s\S]*?\{ immediate: true \}\);/);
        expect(watcher).not.toBeNull();
        expect(watcher[0]).toContain('pendingExpandIds(rows.value, autoExpandedIds.value)');
    });

    test('each group loads the progress aggregate and hands it to its rows', () => {
        expect(group).toMatch(/watch\(\(\) => progressSignature\(rows\.value\), loadSubtaskCounts, \{ immediate: true \}\)/);
        expect(group).toContain('findQuery: progressQuery(ids)');
        expect(group).toContain(':progress="progressFor(task._id)"');
    });

    test('the row takes its fraction from the shared helper, never from subtaskArray alone', () => {
        expect(row).toContain('subtaskProgress(props.data, props.progress)');
        expect(row).not.toMatch(/subtaskArray \|\| \[\]\)\.filter/);
    });
});

describe('the sprint header count says what it counts', () => {
    const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

    /* The header (sprints.tasks) counts parents + subtasks; the burndown counts parents.
       Both are right for their own definition, so the header is labelled, not changed. */
    test('the header number carries the hint', () => {
        const view = read('frontend/src/views/Projects/ListView/ListView.vue');
        const meta = view.split('\n').find((line) => line.includes('lv2__sprint-meta'));
        expect(meta).toMatch(/:title="\$t\('List\.sprint_total_hint'\)"/);
        expect(meta).toContain('sprint.tasks');
    });

    test('the hint is keyed in en.js and names both definitions', () => {
        const hint = read('frontend/src/locales/en.js').match(/sprint_total_hint: "([^"]+)"/);
        expect(hint).not.toBeNull();
        expect(hint[1]).toMatch(/subtask/i);
        expect(hint[1]).toMatch(/burndown|parent/i);
    });

    test('the burndown still counts parent tasks only', () => {
        expect(read('Modules/Sprints/burndown.js')).toContain('isParentTask: true');
    });
});
