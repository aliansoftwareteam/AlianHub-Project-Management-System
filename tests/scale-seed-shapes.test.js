process.env.STORAGE_TYPE = process.env.STORAGE_TYPE || 'server';

const mongoose = require('mongoose');
const { schema } = require('../utils/mongo-handler/schema');
const { commentSchema } = require('../utils/mongo-handler/createSchema');
const { Task, driverWrites, isObjectId } = require('./fixtures/realTaskStore');
const { realModelStore } = require('./fixtures/realModelStore');
const { buildTaskStatusData } = require('../Modules/Setup/demoProject');
const { TemplateData: taskStatusTemplates } = require('../utils/Tempates/task_status');
const { TemplateData: taskTypeTemplates } = require('../utils/Tempates/task_type');
const { generateTasks, countersOf } = require('../scripts/scale/lib/generate');
const {
    PROJECT, TAGS, FIELDS, STATUS_COUNT, LIST_COUNT, MEMBER_COUNT, SHARES, GROUP_INDEX_STEP, DAY_MS, DUE_WINDOW_DAYS, listName,
} = require('../scripts/scale/lib/shape');

const { ObjectId } = mongoose.Types;
const id = (n) => new ObjectId(String(n).padStart(24, '0'));
const defaultOf = (templates) => templates.find((template) => template.default) || templates[0];

const ANCHOR = new Date('2026-10-01T00:00:00.000Z');
const COUNT = 5000;

const context = () => ({
    companyId: String(id(1)),
    project: {
        _id: id(2),
        ProjectCode: PROJECT.code,
        taskStatusData: buildTaskStatusData(JSON.parse(JSON.stringify(defaultOf(taskStatusTemplates())))),
        taskTypeCounts: defaultOf(taskTypeTemplates()).taskTypes,
        tagsArray: TAGS,
    },
    lists: Array.from({ length: LIST_COUNT }, (_, n) => ({ _id: id(100 + n), name: listName(n) })),
    memberIds: Array.from({ length: MEMBER_COUNT }, (_, n) => String(id(200 + n))),
    ownerId: String(id(199)),
    fields: FIELDS.map((field, n) => ({ ...field, _id: id(300 + n) })),
    anchor: ANCHOR,
});

const rows = [...generateTasks(context(), COUNT)];
const tasks = rows.map((row) => row.task);
const subtasks = rows.flatMap((row) => row.subtasks);
const comments = rows.flatMap((row) => row.comments);
const share = (list) => list.length / COUNT;

// The keys frontend/src/components/organisms/QuickCreateTask/QuickCreateTask.vue sends to POST /api/v2/tasks.
const WEB_APP_CREATE_KEYS = ['TaskName', 'TaskKey', 'AssigneeUserId', 'watchers', 'DueDate', 'dueDateDeadLine', 'TaskType', 'TaskTypeKey', 'ParentTaskId', 'ProjectID', 'CompanyId', 'status', 'isParentTask', 'Task_Leader', 'sprintArray', 'Task_Priority', 'deletedStatusKey', 'sprintId', 'statusType', 'statusKey'];

describe('a generated task is a task the app could have stored', () => {
    const declared = new Set([...Object.keys(schema.tasks), '_id', 'createdAt', 'updatedAt']);

    it('passes the task schema, parents and subtasks alike', () => {
        const invalid = [...tasks, ...subtasks].map((doc) => new Task(doc).validateSync()).filter(Boolean);
        expect(invalid).toEqual([]);
    });

    it('sets only fields the strict schema declares, so nothing is dropped on the way in', () => {
        const undeclared = new Set([...tasks, ...subtasks].flatMap((doc) => Object.keys(doc)).filter((key) => !declared.has(key)));
        expect([...undeclared]).toEqual([]);
    });

    it('carries every field the web app sends when it creates a task', () => {
        [tasks[0], subtasks[0]].forEach((doc) => {
            expect(WEB_APP_CREATE_KEYS.filter((key) => !(key in doc))).toEqual([]);
        });
    });

    it('reaches the driver in the stored form: ObjectId references, its own id and dates, the schema defaults', async () => {
        const family = rows.find((row) => row.subtasks.length);
        const { writes, error } = await driverWrites('insertMany', [[family.task, family.subtasks[0]], { ordered: false }]);
        expect(error).toBeNull();
        const [parent, child] = writes.find((write) => write.op === 'insertMany').args[0];

        expect(String(parent._id)).toBe(String(family.task._id));
        expect(parent.createdAt).toEqual(family.task.createdAt);
        expect(parent.updatedAt).toEqual(family.task.createdAt);
        ['_id', 'ProjectID', 'CompanyId', 'sprintId'].forEach((key) => expect(isObjectId(parent[key])).toBe(true));
        expect(isObjectId(parent.sprintArray.id)).toBe(true);
        expect(parent.status).toEqual({ text: expect.any(String), key: parent.statusKey, type: parent.statusType });
        expect(parent).toMatchObject({ relations: [], reactions: [], links: [], estimateChangedFlag: false, isParentTask: true, ParentTaskId: '' });

        expect(child).toMatchObject({ isParentTask: false, ParentTaskId: String(parent._id) });
        expect(String(child.sprintId)).toBe(String(parent.sprintId));
        expect(child.groupByStatusIndex).toBeUndefined();
    });

    it('stores due dates the way the create path does: a date and a one-date deadline list, or neither', () => {
        tasks.forEach((task) => {
            if (task.DueDate) expect(task.dueDateDeadLine).toEqual([task.DueDate]);
            else expect(task).toMatchObject({ DueDate: null, dueDateDeadLine: [] });
        });
    });

    it('stores custom field values per field type the way the task panel writes them', () => {
        const byId = Object.fromEntries(context().fields.map((field) => [String(field._id), field]));
        const seen = new Set();
        tasks.filter((task) => task.customField).forEach((task) => {
            Object.entries(task.customField).forEach(([fieldId, detail]) => {
                const field = byId[fieldId];
                expect(detail._id).toBe(fieldId);
                seen.add(field.fieldType);
                if (field.fieldType === 'dropdown') expect(field.fieldOptions.map((option) => option.id)).toContain(detail.fieldValue[0]);
                if (field.fieldType === 'number') expect(detail.fieldValue).toMatch(/^\d+$/);
                if (field.fieldType === 'date') expect(new Date(detail.fieldValue).toISOString()).toBe(detail.fieldValue);
                if (field.fieldType === 'text') expect(typeof detail.fieldValue).toBe('string');
                if (field.fieldType === 'checkbox') expect(typeof detail.fieldValue).toBe('boolean');
            });
        });
        expect([...seen].sort()).toEqual(['checkbox', 'date', 'dropdown', 'number', 'text']);
    });
});

describe('a generated comment is a task comment the app could have stored', () => {
    const { Model, driverWrites: commentWrites } = realModelStore('comments', commentSchema);

    it('passes the comment schema and names its task, list and project by ObjectId', async () => {
        expect(comments.map((doc) => new Model(doc).validateSync()).filter(Boolean)).toEqual([]);
        const { writes } = await commentWrites('insertMany', [[comments[0]], { ordered: false }]);
        const [stored] = writes.find((write) => write.op === 'insertMany').args[0];
        ['taskId', 'sprintId', 'projectId'].forEach((key) => expect(isObjectId(stored[key])).toBe(true));
        expect(stored).toMatchObject({ type: 'text', project: false, mentionIds: [] });
        expect(stored.createdAt).toEqual(comments[0].createdAt);
    });

    it('belongs to a generated parent task and is written by a seeded member', () => {
        const taskIds = new Set(tasks.map((task) => String(task._id)));
        const members = new Set(context().memberIds);
        comments.forEach((comment) => {
            expect(taskIds.has(String(comment.taskId))).toBe(true);
            expect(members.has(comment.userId)).toBe(true);
        });
    });
});

describe('the data has the benchmark shape', () => {
    it('uses the six statuses, the twenty lists and all thirty members', () => {
        expect(new Set(tasks.map((task) => task.statusKey)).size).toBe(STATUS_COUNT);
        expect(new Set(tasks.map((task) => String(task.sprintId))).size).toBe(LIST_COUNT);
        expect(new Set(tasks.flatMap((task) => task.AssigneeUserId)).size).toBe(MEMBER_COUNT);
        expect(new Set(tasks.map((task) => task.Task_Priority))).toEqual(new Set(['HIGH', 'MEDIUM', 'LOW']));
    });

    it('puts custom field values on about 60% of tasks, subtasks on about 10% and comments on about 20%', () => {
        expect(share(tasks.filter((task) => task.customField))).toBeCloseTo(SHARES.customFields, 1);
        expect(Math.abs(share(rows.filter((row) => row.subtasks.length)) - SHARES.subtasks)).toBeLessThan(0.015);
        expect(Math.abs(share(rows.filter((row) => row.comments.length)) - SHARES.comments)).toBeLessThan(0.015);
    });

    it('spreads due dates across a year around the anchor day and creates nothing in the future', () => {
        const due = tasks.filter((task) => task.DueDate).map((task) => task.DueDate.getTime());
        expect(Math.min(...due)).toBeGreaterThanOrEqual(ANCHOR.getTime() - DUE_WINDOW_DAYS.before * DAY_MS);
        expect(Math.max(...due)).toBeLessThan(ANCHOR.getTime() + DUE_WINDOW_DAYS.after * DAY_MS);
        expect(Math.max(...due) - Math.min(...due)).toBeGreaterThan(300 * DAY_MS);
        [...tasks, ...subtasks, ...comments].forEach((doc) => expect(doc.createdAt.getTime()).toBeLessThanOrEqual(ANCHOR.getTime()));
    });

    it('gives tasks estimates, points and tags from the project', () => {
        const tagIds = new Set(TAGS.map((tag) => tag.uid));
        expect(share(tasks.filter((task) => task.totalEstimatedTime > 0))).toBeCloseTo(SHARES.estimate, 1);
        expect(share(tasks.filter((task) => task.points > 0))).toBeCloseTo(SHARES.points, 1);
        tasks.flatMap((task) => task.tagsArray || []).forEach((tag) => expect(tagIds.has(tag)).toBe(true));
        expect(tasks.some((task) => (task.tagsArray || []).length > 1)).toBe(true);
    });
});

describe('the counts add up to what the create path would have left', () => {
    const counters = countersOf(rows);

    it('numbers every task and subtask once, in creation order, and the project counter is the last number', () => {
        const keys = rows.flatMap((row) => [row.task, ...row.subtasks]).map((doc) => doc.TaskKey);
        expect(keys).toEqual(keys.map((_, n) => `${PROJECT.code}-${n + 1}`));
        expect(counters.lastTaskId).toBe(tasks.length + subtasks.length);
        expect(counters).toMatchObject({ tasks: COUNT, subtasks: subtasks.length, comments: comments.length });
    });

    it('counts each list and each task type once per stored task', () => {
        const sum = (bucket) => Object.values(bucket).reduce((total, n) => total + n, 0);
        expect(sum(counters.perList)).toBe(counters.lastTaskId);
        expect(sum(counters.perType)).toBe(counters.lastTaskId);
        expect(sum(counters.perStatus)).toBe(COUNT);
    });

    it('records on each parent the number of subtasks it has', () => {
        rows.forEach((row) => expect(row.task.subTasks).toBe(row.subtasks.length || undefined));
        expect(tasks.reduce((total, task) => total + (task.subTasks || 0), 0)).toBe(subtasks.length);
    });

    it('orders each status column like the app: every new task one step above the last', () => {
        const perStatus = new Map();
        tasks.forEach((task) => {
            const placed = perStatus.get(task.statusKey) || 0;
            expect(task.groupByStatusIndex).toBe(placed === 0 ? 0 : -GROUP_INDEX_STEP * placed);
            perStatus.set(task.statusKey, placed + 1);
        });
    });

    it('gives every document its own id', () => {
        const ids = [...tasks, ...subtasks, ...comments].map((doc) => String(doc._id));
        expect(new Set(ids).size).toBe(ids.length);
    });
});

describe('the generator is repeatable', () => {
    const plain = (list) => JSON.parse(JSON.stringify(list));

    it('produces the same documents on every run', () => {
        expect(plain([...generateTasks(context(), 300)])).toEqual(plain(rows.slice(0, 300)));
    });

    it('makes a smaller data set a prefix of a larger one, so 10,000 tasks can be topped up to 50,000', () => {
        const larger = [...generateTasks(context(), COUNT + 50)];
        expect(plain(larger.slice(0, COUNT))).toEqual(plain(rows));
    });
});
