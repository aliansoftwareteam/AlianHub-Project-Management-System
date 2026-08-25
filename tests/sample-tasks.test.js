/* Validates the seeded sample-task document against the REAL tasks schema.

   This exists because the document was built by copying shapes from a create-project payload
   instead of reading the schema, and three fields were wrong in ways nothing surfaced: the insert
   failed inside a catch that only logged, so a project appeared with no tasks and no error.

   What was wrong, and what this locks in:
     Task_Leader  is a required String holding a user id — an [] and then an '' both failed
     status       is an object { text, key, type } — a bare 1 passes validation but is not what
                  every real task carries
     sprintArray  holds the whole sprint document, not an array
*/
const mongoose = require('mongoose');
const { schema } = require('../utils/mongo-handler/schema.js');
const { buildTaskDocs, WELCOME_TASKS, SAMPLE_TASKS } = require('../utils/sampleTasks.js');

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
};
const sprint = { _id: '67beeeea2930c35b90cd874c', name: 'List', projectId: project._id, tasks: 0 };

describe('seeded sample task documents', () => {
    const docs = buildTaskDocs(project, sprint, WELCOME_TASKS, 0, OWNER);

    test('one document per row', () => {
        expect(docs).toHaveLength(WELCOME_TASKS.length);
    });

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
        // and an absent owner must not silently produce an invalid document
        const orphan = buildTaskDocs(project, sprint, WELCOME_TASKS, 0, '');
        expect(new TaskModel(orphan[0]).validateSync()).toBeTruthy();
    });

    test('status is the object shape every real task carries', () => {
        for (const doc of docs) {
            expect(typeof doc.status).toBe('object');
            expect(doc.status).toEqual({ text: 'To Do', key: 1, type: 'default_active' });
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
            expect(typeof doc.description).toBe('string');
            expect(doc.description.length).toBeGreaterThan(0);
            // One paragraph block per line; joined back together they are the plain description.
            const joined = doc.descriptionBlock.blocks.map((b) => b.data.text).join('\n');
            expect(joined).toBe(doc.description);
            expect(doc.descriptionBlock.blocks.length).toBeGreaterThan(1);
            for (const b of doc.descriptionBlock.blocks) {
                expect(b.data.text.trim().length).toBeGreaterThan(0);
            }
        }
    });

    test('the demo tasks read as documentation, not one-liners', () => {
        for (const [title, text] of WELCOME_TASKS) {
            expect(text.length).toBeGreaterThan(150);
            expect(text).toMatch(/Try it/);
            expect(text).toMatch(/\n1\. /);
            expect(title.length).toBeLessThan(80);
        }
    });

    test('task keys continue from the project lastTaskId rather than colliding', () => {
        const fresh = buildTaskDocs(project, sprint, WELCOME_TASKS, 0, OWNER);
        expect(fresh[0].TaskKey).toBe('WELCOME-1');
        const continued = buildTaskDocs(project, sprint, WELCOME_TASKS, 40, OWNER);
        expect(continued[0].TaskKey).toBe('WELCOME-41');
    });

    test('every template set also produces valid documents', () => {
        for (const [name, rows] of Object.entries(SAMPLE_TASKS)) {
            const built = buildTaskDocs(project, sprint, rows, 0, OWNER);
            for (const doc of built) {
                const err = new TaskModel(doc).validateSync();
                expect(err ? `${name}: ${Object.keys(err.errors)}` : '').toBe('');
            }
        }
    });
});
