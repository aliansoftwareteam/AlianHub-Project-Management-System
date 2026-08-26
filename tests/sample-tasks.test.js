/* Validates the seeded sample-task documents against the REAL tasks schema, and checks the demo
   project is populated like a project someone has actually been working in.

   The schema half exists because the document was once built by copying shapes from a
   create-project payload instead of reading the schema, and three fields were wrong in ways nothing
   surfaced: the insert failed inside a catch that only logged, so a project appeared with no tasks
   and no error.

   The variety half exists because the demo project looked empty even with eleven tasks in it —
   every row identical, nothing assigned, no dates, one status — so the board, calendar, workload
   and half the columns had nothing to show.
*/
const mongoose = require('mongoose');
const { schema } = require('../utils/mongo-handler/schema.js');
const { buildTaskDocs, WELCOME_TASKS, SAMPLE_TASKS, WELCOME_PROJECT_NAME } = require('../utils/sampleTasks.js');

const TaskSchema = new mongoose.Schema(schema.tasks, { strict: true, timestamps: true });
const TaskModel = mongoose.models.__SampleTaskProbe
    || mongoose.model('__SampleTaskProbe', TaskSchema);

const OWNER = '664d8a1e00f2ae12ba606d22';
const project = {
    _id: '67beeeea2930c35b90cd873e',
    CompanyId: '664d884cae4b92e071ac3b99',
    ProjectCode: 'WELCOME',
    lastTaskId: 0,
    taskTypeCounts: [{ name: 'Task', key: 1 }],
    // The shape createProject stores, built from the company's task-status template.
    taskStatusData: [
        { name: 'To Do', key: 1, type: 'default_active' },
        { name: 'In Progress', key: 3, type: 'active' },
        { name: 'In Review', key: 4, type: 'active' },
        { name: 'Backlog', key: 5, type: 'active' },
        { name: 'Done', key: 6, type: 'active' },
        { name: 'Complete', key: 2, type: 'close' },
    ],
};
const sprint = { _id: '67beeeea2930c35b90cd874c', name: 'List', projectId: project._id, tasks: 0 };

const templateSets = () => Object.entries(SAMPLE_TASKS)
    .filter(([name]) => name !== WELCOME_PROJECT_NAME).map(([, rows]) => rows);

const build = (rows, from = 0) => buildTaskDocs(project, sprint, rows, from, OWNER);

describe('seeded sample task documents', () => {
    const { docs } = build(WELCOME_TASKS);

    test('every document passes the real tasks schema', () => {
        for (const doc of docs) {
            const err = new TaskModel(doc).validateSync();
            expect(err ? Object.keys(err.errors) : []).toEqual([]);
        }
    });

    test('every required field is present', () => {
        const required = [];
        TaskSchema.eachPath((name, path) => { if (path.isRequired) required.push(name); });
        expect(required.length).toBeGreaterThan(10);
        for (const field of required) {
            expect(docs[0][field]).toBeDefined();
        }
    });

    test('Task_Leader is a non-empty string, which is what failed twice', () => {
        for (const doc of docs) {
            expect(typeof doc.Task_Leader).toBe('string');
            expect(doc.Task_Leader.length).toBeGreaterThan(0);
        }
        const { docs: orphan } = build(WELCOME_TASKS.slice(0, 1));
        expect(orphan[0].Task_Leader).toBe(OWNER);
    });

    test('status is an object and always agrees with statusKey and statusType', () => {
        for (const doc of docs) {
            expect(typeof doc.status).toBe('object');
            expect(doc.status.key).toBe(doc.statusKey);
            expect(doc.status.type).toBe(doc.statusType);
        }
    });

    test('sprintArray holds the sprint document, not an array', () => {
        for (const doc of docs) {
            expect(Array.isArray(doc.sprintArray)).toBe(false);
            expect(String(doc.sprintArray._id)).toBe(String(sprint._id));
        }
    });

    test('descriptions are written both ways so neither view looks empty', () => {
        for (const doc of docs) {
            const joined = doc.descriptionBlock.blocks.map((b) => b.data.text).join('\n');
            expect(joined).toBe(doc.description);
        }
        // The teaching tasks are multi-paragraph. The generated subtask examples are one line, so
        // this only applies to the parents.
        for (const doc of docs.filter((d) => d.isParentTask !== false)) {
            expect(doc.descriptionBlock.blocks.length).toBeGreaterThan(1);
        }
    });

    test('task keys are unique and continue from the project lastTaskId', () => {
        expect(new Set(docs.map((d) => d.TaskKey)).size).toBe(docs.length);
        expect(docs[0].TaskKey).toBe('WELCOME-1');
        const { docs: later } = build(WELCOME_TASKS, 40);
        expect(later[0].TaskKey).toBe('WELCOME-41');
    });

    test('the demo tasks read as documentation, not one-liners', () => {
        for (const row of WELCOME_TASKS) {
            const [title, text] = row;
            expect(text.length).toBeGreaterThan(150);
            expect(text).toMatch(/Try it/);
            expect(text).toMatch(/\n1\. /);
            expect(title.length).toBeLessThan(80);
        }
    });

    test('every template set also produces valid documents', () => {
        for (const [name, rows] of Object.entries(SAMPLE_TASKS).filter(([n]) => n !== WELCOME_PROJECT_NAME)) {
            const { docs: built } = build(rows);
            for (const doc of built) {
                const err = new TaskModel(doc).validateSync();
                expect(err ? `${name}: ${Object.keys(err.errors)}` : '').toBe('');
            }
        }
    });
});

describe('the demo project looks worked-in, not empty', () => {
    const { docs, comments } = build(WELCOME_TASKS);
    const parents = docs.filter((d) => d.isParentTask !== false);

    test('work is spread across more than one column of the board', () => {
        const columns = new Set(docs.map((d) => d.status.text));
        expect(columns.size).toBeGreaterThanOrEqual(3);
        expect([...columns]).toEqual(expect.arrayContaining(['To Do', 'In Progress']));
    });

    test('something is finished, so the done column is not empty', () => {
        expect(docs.some((d) => d.statusType === 'close')).toBe(true);
    });

    test('the assignee column has content and workload has someone to show', () => {
        const assigned = docs.filter((d) => d.AssigneeUserId.length > 0);
        expect(assigned.length).toBeGreaterThanOrEqual(3);
        for (const doc of assigned) expect(doc.AssigneeUserId).toEqual([OWNER]);
    });

    test('every task has a due date, so the calendar is not blank', () => {
        for (const doc of parents) {
            expect(doc.DueDate instanceof Date).toBe(true);
            expect(Number.isNaN(doc.DueDate.getTime())).toBe(false);
        }
        const spread = new Set(parents.map((d) => d.DueDate.toDateString()));
        expect(spread.size).toBeGreaterThanOrEqual(5);
    });

    test('priorities differ, so the flags are not one colour', () => {
        const used = new Set(docs.map((d) => d.Task_Priority));
        expect(used.size).toBeGreaterThanOrEqual(3);
        for (const p of used) expect(['URGENT', 'HIGH', 'MEDIUM', 'LOW']).toContain(p);
    });

    test('the task that teaches subtasks actually has some', () => {
        const parent = parents.find((d) => d.TaskName === 'Break a big task into subtasks');
        expect(parent).toBeDefined();
        expect(parent.subTasks).toBe(3);

        const kids = docs.filter((d) => d.isParentTask === false);
        expect(kids).toHaveLength(3);
        for (const kid of kids) {
            expect(kid.ParentTaskId).toBe(String(parent._id));
            expect(kid.sprintId).toBe(String(sprint._id));
            expect(kid.subTasks).toBe(0);
            expect(new TaskModel(kid).validateSync()).toBeUndefined();
        }
    });

    test('the task that teaches comments actually has one', () => {
        expect(comments).toHaveLength(1);
        const c = comments[0];
        const target = docs.find((d) => String(d._id) === String(c.taskId));
        expect(target.TaskName).toBe('Leave a comment');
        // project is a boolean flag meaning "project-level comment", not the project itself
        expect(c.project).toBe(false);
        expect(c.type).toBe('text');
        expect(c.userId).toBe(OWNER);
        expect(c.message.length).toBeGreaterThan(20);
    });

    test('template projects stay plain — the variety is the demo project only', () => {
        for (const rows of templateSets()) {
            const { docs: built, comments: none } = build(rows);
            expect(none).toHaveLength(0);
            expect(built.every((d) => d.isParentTask !== false)).toBe(true);
            expect(built.every((d) => d.AssigneeUserId.length === 0)).toBe(true);
            expect(new Set(built.map((d) => d.status.text)).size).toBe(1);
        }
    });
});
