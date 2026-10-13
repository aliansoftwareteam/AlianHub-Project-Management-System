/* Task 046 M2, slice N1: the task schema is strict, so `ancestors` reaches the database only once
   it is declared. Every stored form here is read from what Mongoose hands the driver under the
   real task schema; fakeMongo is schemaless and would keep the field either way. */
const mongoose = require('mongoose');
const { Task, driverWrites } = require('./fixtures/realTaskStore');
const { taskSchema } = require('../utils/mongo-handler/createSchema');

const ROOT = '6f0000000000000000000101';
const CHILD = '6f0000000000000000000102';
const GRANDCHILD = '6f0000000000000000000103';
const oid = (id) => new mongoose.Types.ObjectId(id);

const taskDoc = (extra = {}) => ({
    TaskName: 'Write the brief', TaskKey: 'PAR-9', TaskType: 'task', TaskTypeKey: 1, ProjectID: '6f0000000000000000000a01', CompanyId: '6f00000000000000000000c1',
    status: { key: 1, text: 'To Do', type: 'default_active' }, isParentTask: true, Task_Leader: 'owner', sprintArray: { id: '6f0000000000000000000e01', name: 'Sprint 1' },
    Task_Priority: 'MEDIUM', deletedStatusKey: 0, sprintId: '6f0000000000000000000e01', statusType: 'default_active', statusKey: 1, ...extra,
});

describe('the task schema keeps ancestors', () => {
    test('a saved subtask stores its chain as text, root first', async () => {
        const { writes, error } = await driverWrites('save', taskDoc({ _id: GRANDCHILD, isParentTask: false, ParentTaskId: CHILD, ancestors: [oid(ROOT), CHILD], notDeclared: 'dropped' }));

        expect(error).toBeNull();
        const [stored] = writes[0].args;
        expect(stored.ancestors).toEqual([ROOT, CHILD]);
        expect(stored).not.toHaveProperty('notDeclared');
    });

    test('a task saved without one stores an empty chain', async () => {
        const { writes } = await driverWrites('save', taskDoc());

        expect(writes[0].args[0].ancestors).toEqual([]);
    });

    test.each([
        ['updateOne', () => [{ _id: GRANDCHILD }, { $set: { ancestors: [ROOT, CHILD] } }], (args) => args[1]],
        ['updateMany', () => [{ ancestors: CHILD }, { $set: { ancestors: [ROOT, CHILD] } }], (args) => args[1]],
        ['findOneAndUpdate', () => [{ _id: GRANDCHILD }, { $set: { ancestors: [ROOT, CHILD] } }, { new: true }], (args) => args[1]],
        ['bulkWrite', () => [[{ updateOne: { filter: { _id: GRANDCHILD }, update: { $set: { ancestors: [ROOT, CHILD] } } } }]], (args) => args[0][0].updateOne.update],
    ])('%s keeps the field in the update', async (method, args, updateOf) => {
        const { writes, error } = await driverWrites(method, args());

        expect(error).toBeNull();
        expect(updateOf(writes[0].args).$set.ancestors).toEqual([ROOT, CHILD]);
    });

    test('a filter on the field is sent as text, the form the rows hold', async () => {
        const { writes } = await driverWrites('find', [{ ancestors: oid(ROOT) }]);

        expect(writes[0].args[0]).toEqual({ ancestors: ROOT });
    });

    test('a document read back exposes the chain', () => {
        expect(new Task(taskDoc({ ancestors: [ROOT] })).toObject().ancestors).toEqual([ROOT]);
    });

    test('the field is indexed, beside the parent index', () => {
        const keys = taskSchema.indexes().map(([fields]) => fields);

        expect(keys).toContainEqual({ ancestors: 1 });
        expect(keys).toContainEqual({ ParentTaskId: 1 });
    });

    test('depth is not stored: it is the length of the chain', () => {
        expect(taskSchema.path('depth')).toBeUndefined();
    });
});
