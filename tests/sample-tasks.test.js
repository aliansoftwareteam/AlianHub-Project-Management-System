/* The demo project's content: valid against the real schema, and populated like a project someone
   has actually been working in — for EVERY answer the setup wizard accepts.

   Both halves exist because of real failures.

   Schema: the task document was once built by copying shapes from a create-project payload instead
   of reading the schema. Task_Leader is a required String holding a user id (an array, then an
   empty string, both failed), status is an object, sprintArray holds the whole sprint document, and
   TaskType stores the type's value ("task") rather than its display name. The insert failed inside
   a catch that only logged, so a project appeared with no tasks and no error at all.

   Variety: eleven tasks still read as a blank project — every row To Do, nobody assigned, no dates,
   one priority, no subtasks. And the variety was first attached to particular welcome rows, so
   answering "Marketing" during setup swapped those rows out and produced exactly the flat project
   it was meant to prevent. It is applied by position now, over whatever list the demo composes.
*/
const mongoose = require('mongoose');
const { schema } = require('../utils/mongo-handler/schema.js');
const {
    buildTaskDocs, demoTasksForFocus, WELCOME_TASKS, SAMPLE_TASKS,
    WELCOME_PROJECT_NAME, TEAM_FOCUS_OPTIONS,
} = require('../utils/sampleTasks.js');

const TaskSchema = new mongoose.Schema(schema.tasks, { strict: true, timestamps: true });
const TaskModel = mongoose.models.__SampleTaskProbe
    || mongoose.model('__SampleTaskProbe', TaskSchema);

const OWNER = '664d8a1e00f2ae12ba606d22';

// The shape createProject stores on a project, built from the company's own templates.
const project = {
    _id: '67beeeea2930c35b90cd873e',
    CompanyId: '664d884cae4b92e071ac3b99',
    ProjectCode: 'WELCOME',
    lastTaskId: 0,
    taskTypeCounts: [{ name: 'Task', key: 1, value: 'task' }],
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

const build = (rows, from = 0) => buildTaskDocs(project, sprint, rows, from, OWNER);
const demo = (focus = '') => build(demoTasksForFocus(focus));
const templateSets = () => Object.entries(SAMPLE_TASKS)
    .filter(([name]) => name !== WELCOME_PROJECT_NAME).map(([, rows]) => rows);

// Every answer the wizard offers, plus the ways it can arrive unset or wrong.
const ALL_ANSWERS = [...TEAM_FOCUS_OPTIONS, '', null, undefined, 'nonsense'];

describe('the task document matches the real schema', () => {
    test('every document, for every setup answer, validates', () => {
        for (const focus of ALL_ANSWERS) {
            for (const doc of demo(focus).docs) {
                const err = new TaskModel(doc).validateSync();
                expect(err ? `${focus}: ${Object.keys(err.errors)}` : '').toBe('');
            }
        }
    });

    test('every required field is present', () => {
        const required = [];
        TaskSchema.eachPath((name, path) => { if (path.isRequired) required.push(name); });
        expect(required.length).toBeGreaterThan(10);
        for (const field of required) expect(demo().docs[0][field]).toBeDefined();
    });

    test('Task_Leader is a non-empty user id string', () => {
        for (const doc of demo().docs) {
            expect(typeof doc.Task_Leader).toBe('string');
            expect(doc.Task_Leader).toBe(OWNER);
        }
    });

    test('status is an object and always agrees with statusKey and statusType', () => {
        for (const doc of demo().docs) {
            expect(typeof doc.status).toBe('object');
            expect(doc.status.key).toBe(doc.statusKey);
            expect(doc.status.type).toBe(doc.statusType);
        }
    });

    test('sprintArray holds the sprint document, not an array', () => {
        for (const doc of demo().docs) {
            expect(Array.isArray(doc.sprintArray)).toBe(false);
            expect(String(doc.sprintArray._id)).toBe(String(sprint._id));
        }
    });

    test('TaskType stores the type value, the way every real task does', () => {
        for (const doc of demo('marketing').docs) expect(doc.TaskType).toBe('task');
    });

    test('descriptions are written both ways so neither view looks empty', () => {
        const { docs } = demo();
        for (const doc of docs) {
            const joined = doc.descriptionBlock.blocks.map((b) => b.data.text).join('\n');
            expect(joined).toBe(doc.description);
        }
        // Teaching tasks are multi-paragraph; the generated subtask examples are one line.
        for (const doc of docs.filter((d) => d.isParentTask !== false)) {
            expect(doc.descriptionBlock.blocks.length).toBeGreaterThan(1);
        }
    });

    test('task keys are unique and continue from the project lastTaskId', () => {
        const { docs } = demo();
        expect(new Set(docs.map((d) => d.TaskKey)).size).toBe(docs.length);
        expect(docs[0].TaskKey).toBe('WELCOME-1');
        expect(build(demoTasksForFocus(''), 40).docs[0].TaskKey).toBe('WELCOME-41');
    });
});

describe('the demo project looks worked-in — whatever the setup answer', () => {
    test.each(ALL_ANSWERS.map((f) => [JSON.stringify(f), f]))('answer %s', (_label, focus) => {
        const { docs, comments } = demo(focus);
        const parents = docs.filter((d) => d.isParentTask !== false);

        // The board has real columns rather than one pile
        const columns = new Set(docs.map((d) => d.status.text));
        expect(columns.size).toBeGreaterThanOrEqual(4);
        expect([...columns]).toEqual(expect.arrayContaining(['To Do', 'In Progress']));
        expect(docs.some((d) => d.statusType === 'close')).toBe(true);

        // Assignee column and Workload have someone to show
        expect(docs.filter((d) => d.AssigneeUserId.length > 0).length).toBeGreaterThanOrEqual(4);

        // Calendar is not blank, and dates are spread rather than stacked on one day
        for (const doc of parents) expect(doc.DueDate instanceof Date).toBe(true);
        expect(new Set(parents.map((d) => d.DueDate.toDateString())).size).toBeGreaterThanOrEqual(6);

        // Priority flags are not all one colour
        const used = new Set(docs.map((d) => d.Task_Priority));
        expect(used.size).toBeGreaterThanOrEqual(3);
        for (const p of used) expect(['URGENT', 'HIGH', 'MEDIUM', 'LOW']).toContain(p);

        // The expand arrow has something to open, and the chat column is not empty
        expect(docs.filter((d) => d.isParentTask === false)).toHaveLength(3);
        expect(comments).toHaveLength(1);
    });

    test('marketing — the answer that exposed this — carries both halves', () => {
        const { docs, comments } = demo('marketing');
        expect(docs[0].TaskName).toBe('Start here — this project is a sandbox');
        expect(docs.some((d) => d.TaskName === 'Draft the message')).toBe(true);
        expect(docs.filter((d) => d.isParentTask === false)).toHaveLength(3);
        expect(comments).toHaveLength(1);
    });

    test('subtasks point at their parent and are valid on their own', () => {
        const { docs } = demo('marketing');
        const kids = docs.filter((d) => d.isParentTask === false);
        const parent = docs.find((d) => d.subTasks > 0);
        expect(parent).toBeDefined();
        expect(parent.subTasks).toBe(kids.length);
        for (const kid of kids) {
            expect(kid.ParentTaskId).toBe(String(parent._id));
            expect(kid.sprintId).toBe(String(sprint._id));
            expect(kid.subTasks).toBe(0);
            expect(new TaskModel(kid).validateSync()).toBeUndefined();
        }
    });

    test('the comment is attached to a task that exists', () => {
        const { docs, comments } = demo('support');
        const c = comments[0];
        expect(docs.some((d) => String(d._id) === String(c.taskId))).toBe(true);
        // project is a boolean flag meaning "project-level comment", not the project itself
        expect(c.project).toBe(false);
        expect(c.type).toBe('text');
        expect(c.userId).toBe(OWNER);
    });
});

describe('templates used for real projects stay plain', () => {
    test('no assignees, no comments, no subtasks, one status', () => {
        for (const rows of templateSets()) {
            const { docs, comments } = build(rows);
            expect(comments).toHaveLength(0);
            expect(docs.every((d) => d.isParentTask !== false)).toBe(true);
            expect(docs.every((d) => d.AssigneeUserId.length === 0)).toBe(true);
            expect(new Set(docs.map((d) => d.status.text)).size).toBe(1);
            expect(docs.every((d) => d.DueDate === null)).toBe(true);
        }
    });

    test('and they still validate', () => {
        for (const rows of templateSets()) {
            for (const doc of build(rows).docs) {
                expect(new TaskModel(doc).validateSync()).toBeUndefined();
            }
        }
    });
});

describe('the demo task text reads as documentation', () => {
    test('each one explains a feature and ends with a numbered exercise', () => {
        for (const [title, text] of WELCOME_TASKS) {
            expect(text.length).toBeGreaterThan(150);
            expect(text).toMatch(/Try it/);
            expect(text).toMatch(/\n1\. /);
            expect(title.length).toBeLessThan(80);
        }
    });
});

/* The demo project is split across sprints like a real one, rather than being a single flat list.
   The project arrives with one sprint called "List"; that is renamed and two more are created. */
describe('the demo project is split across sprints', () => {
    const { DEMO_SPRINTS } = require('../utils/sampleTasks.js');

    test('three named sprints, and none of them is called List', () => {
        expect(DEMO_SPRINTS).toHaveLength(3);
        for (const name of DEMO_SPRINTS) {
            expect(typeof name).toBe('string');
            expect(name).not.toBe('List');
            expect(name.length).toBeGreaterThan(3);
        }
    });

    test.each(ALL_ANSWERS.map((f) => [JSON.stringify(f), f]))('answer %s spreads work over all three', (_label, focus) => {
        const rows = demoTasksForFocus(focus);
        const used = new Set(rows.map((r) => (r[2] || {}).sprint));
        expect([...used].sort()).toEqual([0, 1, 2]);
        // and every row names one, so nothing silently falls into the first
        for (const row of rows) expect((row[2] || {}).sprint).toBeDefined();
    });

    test('a subtask always sits in the same sprint as its parent', () => {
        // Three distinct sprint documents, so a mismatch would show up as a different id.
        const sprints = DEMO_SPRINTS.map((name, i) => ({
            _id: `67beeeea2930c35b90cd87${40 + i}`, name, projectId: project._id, tasks: 0,
        }));
        const { docs } = buildTaskDocs(project, sprints, demoTasksForFocus(''), 0, OWNER);
        const parent = docs.find((d) => d.subTasks > 0);
        const kids = docs.filter((d) => d.isParentTask === false);
        expect(kids).toHaveLength(3);
        for (const kid of kids) expect(kid.sprintId).toBe(parent.sprintId);
    });

    test('the tasks that teach subtasks and comments are the ones that have them', () => {
        const sprints = DEMO_SPRINTS.map((name, i) => ({
            _id: `67beeeea2930c35b90cd87${40 + i}`, name, projectId: project._id, tasks: 0,
        }));
        const { docs, comments } = buildTaskDocs(project, sprints, demoTasksForFocus(''), 0, OWNER);
        expect(docs.find((d) => d.subTasks > 0).TaskName).toBe('Break a big task into subtasks');
        expect(docs.find((d) => String(d._id) === String(comments[0].taskId)).TaskName)
            .toBe('Leave a comment');
    });

    test('template projects still get a single sprint', () => {
        for (const rows of templateSets()) {
            expect(rows.every((r) => r[2] === undefined)).toBe(true);
        }
    });
});
