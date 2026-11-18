/* Task 046 M3, slice L1: the rules of a task's extra lists, and the stored field. The rules take
   plain rows and require nothing. Every stored form is read from what Mongoose hands the driver
   under the real task schema; fakeMongo is schemaless and would keep the field either way. */
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { Task, driverWrites } = require('./fixtures/realTaskStore');
const { taskSchema } = require('../utils/mongo-handler/createSchema');
const rules = require('../Modules/Tasks/helpers/taskExtraListsRules');

const { MAX_EXTRA_LISTS, POLICY, REFUSALS, canHoldExtraLists, canBeExtraList, canAddToList, extraListsOf, entryFor } = rules;

const HOME = '6f0000000000000000000a01';
const OTHER = '6f0000000000000000000a02';
const HOME_LIST = '6f0000000000000000000e01';
const LIST = '6f0000000000000000000e02';
const TASK = '6f0000000000000000000b01';
const oid = (id) => new mongoose.Types.ObjectId(id);

const task = (extra = {}) => ({ _id: TASK, ProjectID: HOME, sprintId: HOME_LIST, ParentTaskId: '', deletedStatusKey: 0, ...extra });
const project = (extra = {}) => ({ _id: OTHER, statusType: 'active', deletedStatusKey: 0, ...extra });
const list = (extra = {}) => ({ _id: LIST, projectId: OTHER, deletedStatusKey: 0, ...extra });
const refused = (code) => ({ ok: false, code, reason: REFUSALS[code] });

describe('the rules require nothing', () => {
    test('so the web app can share the file', () => {
        const source = fs.readFileSync(path.join(__dirname, '../Modules/Tasks/helpers/taskExtraListsRules.js'), 'utf8');

        expect(source).not.toMatch(/\brequire\(|\bimport\b/);
    });

    test('every refusal has its words', () => {
        Object.values(REFUSALS).forEach((reason) => expect(reason).toMatch(/\w{3,}/));
    });
});

describe('which task may be in extra lists', () => {
    test('a live top-level task in an open project', () => {
        expect(canHoldExtraLists(task(), project({ _id: HOME }))).toEqual({ ok: true });
    });

    test.each([
        ['a subtask', task({ ParentTaskId: '6f0000000000000000000b02' }), project(), 'SUBTASK'],
        ['a chat conversation', task({ mainChat: true }), project(), 'CHAT_ROW'],
        ['a row with no project behind it', task(), null, 'CHAT_ROW'],
        ['an archived task', task({ deletedStatusKey: 2 }), project(), 'TASK_NOT_LIVE'],
        ['a task of a closed project', task({ deletedStatusKey: 8 }), project({ statusType: 'close' }), 'TASK_NOT_LIVE'],
        ['a live task in a closed project', task(), project({ statusType: 'close' }), 'HOME_PROJECT_NOT_OPEN'],
        ['a task in a personal list', task(), project({ isPersonal: true }), 'HOME_PERSONAL_LIST'],
    ])('%s may not', (_, row, home, code) => {
        expect(canHoldExtraLists(row, home)).toEqual(refused(code));
    });

    test('a task that still holds the chain it had as a subtask is the top-level task it is', () => {
        expect(canHoldExtraLists(task({ ancestors: ['6f0000000000000000000b02'] }), project())).toEqual({ ok: true });
    });
});

describe('which list may be an extra list', () => {
    test('a live list in an open project', () => {
        expect(canBeExtraList(list(), project())).toEqual({ ok: true });
    });

    test.each([
        ['a Scrum sprint', list({ isScrum: true }), project(), 'SCRUM_LIST'],
        ['a backlog', list({ isBacklog: true }), project(), 'SCRUM_LIST'],
        ['a personal list', list(), project({ isPersonal: true }), 'PERSONAL_LIST'],
        ['an archived list', list({ deletedStatusKey: 2 }), project(), 'LIST_NOT_LIVE'],
        ['a list in a closed project', list(), project({ statusType: 'close' }), 'PROJECT_NOT_OPEN'],
        ['a list in an archived project', list(), project({ deletedStatusKey: 2 }), 'PROJECT_NOT_OPEN'],
    ])('%s may not', (_, row, home, code) => {
        expect(canBeExtraList(row, home)).toEqual(refused(code));
    });

    test('Scrum sprints and personal lists are each refused by one switch', () => {
        expect(POLICY).toEqual({ scrumLists: false, personalLists: false });
        expect(Object.isFrozen(POLICY)).toBe(true);

        expect(canBeExtraList(list({ isScrum: true }), project(), { ...POLICY, scrumLists: true })).toEqual({ ok: true });
        expect(canBeExtraList(list({ isBacklog: true }), project(), { ...POLICY, scrumLists: true })).toEqual({ ok: true });
        expect(canBeExtraList(list(), project({ isPersonal: true }), { ...POLICY, personalLists: true })).toEqual({ ok: true });
        expect(canHoldExtraLists(task(), project({ isPersonal: true }), { ...POLICY, personalLists: true })).toEqual({ ok: true });
        expect(canBeExtraList(list({ isScrum: true }), project(), { ...POLICY, personalLists: true })).toEqual(refused('SCRUM_LIST'));
    });
});

describe('which list a task may gain', () => {
    const entries = (count) => Array.from({ length: count }, (_, at) => ({ projectId: oid(OTHER), sprintId: oid(`6f00000000000000000000${(0x10 + at).toString(16)}`) }));

    test('one it is not in', () => {
        expect(canAddToList(task(), LIST)).toEqual({ ok: true });
        expect(canAddToList(task({ extraLists: entries(MAX_EXTRA_LISTS - 1) }), LIST)).toEqual({ ok: true });
    });

    test('never its home, in whichever form the ids are held', () => {
        expect(canAddToList(task(), HOME_LIST)).toEqual(refused('HOME_LIST'));
        expect(canAddToList(task({ sprintId: oid(HOME_LIST) }), HOME_LIST)).toEqual(refused('HOME_LIST'));
        expect(canAddToList(task(), oid(HOME_LIST))).toEqual(refused('HOME_LIST'));
    });

    test('never the same list twice', () => {
        expect(canAddToList(task({ extraLists: [{ projectId: oid(OTHER), sprintId: oid(LIST) }] }), LIST)).toEqual(refused('ALREADY_IN_LIST'));
    });

    test(`never more than ${MAX_EXTRA_LISTS}`, () => {
        expect(MAX_EXTRA_LISTS).toBe(10);
        expect(canAddToList(task({ extraLists: entries(MAX_EXTRA_LISTS) }), LIST)).toEqual(refused('TOO_MANY_LISTS'));
    });

    test('a row written before the field existed is in none', () => {
        expect(extraListsOf(task())).toEqual([]);
        expect(extraListsOf(null)).toEqual([]);
        expect(entryFor(task(), LIST)).toBeNull();
    });
});

describe('the task schema keeps extraLists', () => {
    const taskDoc = (extra = {}) => ({
        TaskName: 'Write the brief', TaskKey: 'PAR-9', TaskType: 'task', TaskTypeKey: 1, ProjectID: HOME, CompanyId: '6f00000000000000000000c1',
        status: { key: 1, text: 'To Do', type: 'default_active' }, isParentTask: true, Task_Leader: 'owner', sprintArray: { id: HOME_LIST, name: 'Sprint 1' },
        Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: HOME_LIST, statusType: 'default_active', statusKey: 1, ...extra,
    });
    const entry = { projectId: OTHER, sprintId: LIST, addedBy: 'u1', addedAt: '2026-10-01T00:00:00.000Z', notDeclared: 'dropped' };

    test('an update that adds an entry stores its two ids as ObjectIds and nothing undeclared', async () => {
        const { writes, error } = await driverWrites('findOneAndUpdate', [{ _id: TASK }, { $push: { extraLists: entry } }, { returnDocument: 'after' }]);

        expect(error).toBeNull();
        const pushed = writes[0].args[1].$push.extraLists.toObject();
        expect(pushed).toEqual({ projectId: oid(OTHER), sprintId: oid(LIST), addedBy: 'u1', addedAt: new Date('2026-10-01T00:00:00.000Z') });
        expect(pushed.sprintId).toBeInstanceOf(mongoose.Types.ObjectId);
    });

    test('an update that takes one away matches the stored ObjectId', async () => {
        const { writes } = await driverWrites('findOneAndUpdate', [{ _id: TASK }, { $pull: { extraLists: { sprintId: LIST } } }, { returnDocument: 'after' }]);

        expect(writes[0].args[1].$pull.extraLists.sprintId).toBeInstanceOf(mongoose.Types.ObjectId);
    });

    test('a filter on a list is sent as the ObjectId the rows hold', async () => {
        const { writes } = await driverWrites('find', [{ 'extraLists.sprintId': LIST, deletedStatusKey: 0 }]);

        expect(writes[0].args[0]['extraLists.sprintId']).toBeInstanceOf(mongoose.Types.ObjectId);
    });

    test('a new task stores no field at all, so nothing is rewritten for the tasks that exist', async () => {
        const { writes } = await driverWrites('save', taskDoc());

        expect(writes[0].args[0]).not.toHaveProperty('extraLists');
    });

    test('a new task document never carries the lists of the row it was built from', async () => {
        const saved = await driverWrites('save', taskDoc({ extraLists: [entry] }));
        const inserted = await driverWrites('insertMany', [[taskDoc({ extraLists: [entry] }), taskDoc()]]);

        expect(saved.error).toBeNull();
        expect(saved.writes[0].args[0]).not.toHaveProperty('extraLists');
        expect(saved.writes[0].args[0].TaskName).toBe('Write the brief');
        expect(inserted.error).toBeNull();
        inserted.writes[0].args[0].forEach((doc) => expect(doc.extraLists).toBeUndefined());
    });

    test('a document read back exposes its lists', () => {
        const read = Task.hydrate({ ...taskDoc({ _id: oid(TASK) }), extraLists: [{ projectId: oid(OTHER), sprintId: oid(LIST), addedBy: 'u1' }] }).toObject();

        expect(read.extraLists).toEqual([{ projectId: oid(OTHER), sprintId: oid(LIST), addedBy: 'u1' }]);
    });

    test('the lookup by list is indexed once', () => {
        const keys = taskSchema.indexes().map(([fields]) => JSON.stringify(fields));

        expect(keys.filter((key) => key === JSON.stringify({ 'extraLists.sprintId': 1, deletedStatusKey: 1 }))).toHaveLength(1);
    });
});
