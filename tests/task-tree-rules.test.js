/* Task 046 M2, slice N1: the rules of the stored task tree. A task keeps its chain of parents in
   `ancestors` (root first), three levels at most, and a row written before the field existed reads
   as a top-level task. */
const mongoose = require('mongoose');

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const tree = require('../Modules/Tasks/helpers/taskTree');

const C1 = '6f00000000000000000000c1';
const C2 = '6f00000000000000000000c2';
const ROOT = '6f0000000000000000000101';
const CHILD = '6f0000000000000000000102';
const GRANDCHILD = '6f0000000000000000000103';
const OTHER_ROOT = '6f0000000000000000000201';
const OTHER_CHILD = '6f0000000000000000000202';
const UPDATED_AT = new Date('2026-01-02T03:04:05.000Z');
const oid = (id) => new mongoose.Types.ObjectId(id);

const root = { _id: oid(ROOT), isParentTask: true };
const child = { _id: oid(CHILD), ParentTaskId: ROOT, ancestors: [ROOT] };
const grandchild = { _id: oid(GRANDCHILD), ParentTaskId: CHILD, ancestors: [ROOT, CHILD] };

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
});

describe('depth', () => {
    test('is the number of ancestors, and a row without the field is a top-level task', () => {
        expect(tree.depthOf(root)).toBe(0);
        expect(tree.depthOf({ _id: oid(ROOT), ancestors: [] })).toBe(0);
        expect(tree.depthOf({ _id: oid(ROOT), ancestors: null })).toBe(0);
        expect(tree.depthOf(child)).toBe(1);
        expect(tree.depthOf(grandchild)).toBe(2);
        expect(tree.MAX_DEPTH).toBe(2);
    });

    test('a child stores its parent chain root first, as text', () => {
        expect(tree.ancestorsFor(root)).toEqual([ROOT]);
        expect(tree.ancestorsFor(child)).toEqual([ROOT, CHILD]);
        expect(tree.ancestorsFor({ _id: oid(CHILD), ancestors: [oid(ROOT)] })).toEqual([ROOT, CHILD]);
    });

    test('the root of a task is its first ancestor, or the task itself', () => {
        expect(tree.rootIdOf(root)).toBe(ROOT);
        expect(tree.rootIdOf(grandchild)).toBe(ROOT);
    });
});

describe('subtree height', () => {
    test('counts the levels below the top', () => {
        expect(tree.subtreeHeight(root, [])).toBe(0);
        expect(tree.subtreeHeight(root)).toBe(0);
        expect(tree.subtreeHeight(root, [child])).toBe(1);
        expect(tree.subtreeHeight(root, [child, grandchild])).toBe(2);
        expect(tree.subtreeHeight(child, [grandchild])).toBe(1);
    });
});

describe('the three-level cap', () => {
    test('a task and a subtask can take a leaf', () => {
        expect(tree.canNest(root)).toEqual({ ok: true });
        expect(tree.canNest(child)).toEqual({ ok: true });
        expect(tree.canNest({ _id: oid(ROOT) }, 0)).toEqual({ ok: true });
    });

    test('a level-three subtask takes nothing, and says why', () => {
        const refusal = tree.canNest(grandchild);
        expect(refusal).toEqual({ ok: false, code: 'PARENT_AT_MAX_DEPTH', reason: expect.stringMatching(/three levels/) });
    });

    test('a task with its own subtasks fits only where the whole subtree stays within three levels', () => {
        expect(tree.canNest(root, 1)).toEqual({ ok: true });
        expect(tree.canNest(root, 2)).toEqual({ ok: false, code: 'SUBTREE_TOO_DEEP', reason: expect.stringMatching(/three levels/) });
        expect(tree.canNest(child, 1)).toMatchObject({ ok: false, code: 'SUBTREE_TOO_DEEP' });
        expect(tree.canNest(grandchild, 1)).toMatchObject({ ok: false, code: 'PARENT_AT_MAX_DEPTH' });
    });
});

describe('moving a task with its subtree', () => {
    test('it fits where the whole subtree stays within three levels, and never under itself', () => {
        const lone = { _id: oid(OTHER_ROOT) };
        const otherChild = { _id: oid(OTHER_CHILD), ParentTaskId: OTHER_ROOT, ancestors: [OTHER_ROOT] };

        expect(tree.canMoveUnder(lone, [], child)).toEqual({ ok: true });
        expect(tree.canMoveUnder(lone, [otherChild], root)).toEqual({ ok: true });
        expect(tree.canMoveUnder(lone, [otherChild], child)).toMatchObject({ ok: false, code: 'SUBTREE_TOO_DEEP' });
        expect(tree.canMoveUnder(lone, [], grandchild)).toMatchObject({ ok: false, code: 'PARENT_AT_MAX_DEPTH' });
        expect(tree.canMoveUnder(root, [child, grandchild], grandchild)).toEqual({ ok: false, code: 'PARENT_IS_DESCENDANT', reason: tree.REFUSALS.PARENT_IS_DESCENDANT });
        expect(tree.canMoveUnder(lone, [], lone)).toMatchObject({ ok: false, code: 'PARENT_IS_DESCENDANT' });
    });

    test('a stamp is stale once the task it names is no longer above the row', () => {
        expect(tree.staleStamp({ cascadedBy: ROOT }, [ROOT, CHILD])).toBe(false);
        expect(tree.staleStamp({ cascadedBy: ROOT }, [CHILD])).toBe(true);
        expect(tree.staleStamp({ cascadedBy: ROOT }, [])).toBe(true);
        expect(tree.staleStamp({}, [])).toBe(false);
    });

    test('the rules the web app shares require nothing, and the server module re-exports them', () => {
        const source = require('fs').readFileSync(require.resolve('../Modules/Tasks/helpers/taskTreeRules'), 'utf8');
        const rules = require('../Modules/Tasks/helpers/taskTreeRules');

        expect(source).not.toMatch(/require\(|import /);
        Object.keys(rules).forEach((name) => expect(tree[name]).toBe(rules[name]));
        expect(Object.keys(rules.REFUSALS).sort()).toEqual(['PARENT_AT_MAX_DEPTH', 'PARENT_IS_DESCENDANT', 'PARENT_NOT_FOUND', 'SUBTREE_TOO_DEEP']);
    });
});

describe('cycles', () => {
    test('a task cannot go under itself or under one of its own descendants', () => {
        expect(tree.wouldCycle(root, root)).toBe(true);
        expect(tree.wouldCycle(root, child)).toBe(true);
        expect(tree.wouldCycle(root, grandchild)).toBe(true);
        expect(tree.wouldCycle(child, grandchild)).toBe(true);
    });

    test('a task can go under an unrelated task or under its own ancestor', () => {
        expect(tree.wouldCycle(grandchild, root)).toBe(false);
        expect(tree.wouldCycle(child, { _id: oid(OTHER_ROOT) })).toBe(false);
        expect(tree.wouldCycle(root, { _id: oid(OTHER_CHILD), ancestors: [OTHER_ROOT] })).toBe(false);
    });
});

describe('placement', () => {
    const sprintArray = { id: oid('6f0000000000000000000e01'), name: 'Sprint 1', folderId: oid('6f0000000000000000000f01'), folderName: 'Q4' };
    const placed = { _id: oid(ROOT), TaskName: 'Root', ProjectID: oid('6f0000000000000000000a01'), sprintId: sprintArray.id, sprintArray, folderObjId: sprintArray.folderId, statusKey: 1 };

    test('a descendant copies its project, sprint and folder from the root and nothing else', () => {
        expect(tree.placementFrom(placed)).toEqual({ ProjectID: placed.ProjectID, sprintId: placed.sprintId, sprintArray, folderObjId: placed.folderObjId });
        expect(tree.PLACEMENT_FIELDS).toEqual(['ProjectID', 'sprintId', 'sprintArray', 'folderObjId']);
    });

    test('a root outside a folder gives no folder', () => {
        const atRoot = { ...placed };
        delete atRoot.folderObjId;
        expect(tree.placementFrom(atRoot)).toEqual({ ProjectID: placed.ProjectID, sprintId: placed.sprintId, sprintArray });
        expect(tree.placementFrom({ ...atRoot, folderObjId: null })).not.toHaveProperty('folderObjId');
    });
});

describe('the rows of an import, in the order they are created', () => {
    const row = (_id, ParentTaskId = '') => ({ _id, TaskName: `Row ${_id}`, ParentTaskId });
    const idsIn = (level) => level.map((r) => r._id);

    test('parents come before their children, three levels at most', () => {
        const rows = [row('c', 'b'), row('b', 'a'), row('a'), row('d', 'c'), row('lone')];
        const { levels, parentIdOf, adjusted } = tree.levelRows(rows);

        expect(levels.map(idsIn)).toEqual([['a', 'lone'], ['b'], ['c', 'd']]);
        expect(rows.map((r) => parentIdOf.get(r))).toEqual(['b', 'a', '', 'b', '']);
        expect(adjusted).toEqual([{ _id: 'd', TaskName: 'Row d', reason: 'TOO_DEEP' }]);
    });

    test('a parent that is not among the rows, a loop and a row that names itself make tasks', () => {
        const { levels, adjusted } = tree.levelRows([row('a', 'gone'), row('b', 'a'), row('x', 'y'), row('y', 'x'), row('z', 'x'), row('self', 'self')]);

        expect(levels.map(idsIn)).toEqual([['a', 'x', 'y', 'z', 'self'], ['b'], []]);
        expect(adjusted.map((entry) => `${entry._id} ${entry.reason}`)).toEqual(['a PARENT_MISSING', 'x CYCLE', 'y CYCLE', 'z CYCLE', 'self CYCLE']);
    });
});

describe('the subtree in the database', () => {
    const tasks = (companyId) => mockDbFor(companyId).store[SCHEMA_TYPE.TASKS] || [];
    const stored = (companyId, id) => tasks(companyId).find((t) => String(t._id) === id);
    const seed = (companyId, _id, extra = {}) => mockDbFor(companyId).seed(SCHEMA_TYPE.TASKS, { _id: oid(_id), TaskName: _id, updatedAt: UPDATED_AT, ...extra });
    const seedTree = (companyId) => {
        seed(companyId, ROOT);
        seed(companyId, CHILD, { ParentTaskId: ROOT, ancestors: [ROOT], deletedStatusKey: 0 });
        seed(companyId, GRANDCHILD, { ParentTaskId: CHILD, ancestors: [ROOT, CHILD], deletedStatusKey: 2 });
        seed(companyId, OTHER_ROOT);
        seed(companyId, OTHER_CHILD, { ParentTaskId: OTHER_ROOT, ancestors: [OTHER_ROOT], deletedStatusKey: 0 });
    };

    test('the slot under a parent is its chain and the placement of its root, within the company', async () => {
        const placement = { ProjectID: oid('6f0000000000000000000a01'), sprintId: oid('6f0000000000000000000e01'), sprintArray: { id: oid('6f0000000000000000000e01'), name: 'Sprint 1' } };
        seed(C1, ROOT, placement);
        seed(C1, CHILD, { ParentTaskId: ROOT, ancestors: [ROOT], sprintId: oid('6f0000000000000000000e02') });
        seed(C1, GRANDCHILD, { ParentTaskId: CHILD, ancestors: [ROOT, CHILD] });
        seed(C2, OTHER_ROOT, placement);

        expect(await tree.slotUnder(C1, CHILD)).toMatchObject({ ok: true, ancestors: [ROOT, CHILD], placement });
        expect(await tree.slotUnder(C1, oid(ROOT))).toMatchObject({ ok: true, ancestors: [ROOT], placement });
        expect(await tree.slotUnder(C1, GRANDCHILD)).toMatchObject({ ok: false, code: 'PARENT_AT_MAX_DEPTH' });
        expect(await tree.slotUnder(C1, OTHER_ROOT)).toEqual({ ok: false, code: 'PARENT_NOT_FOUND', reason: tree.REFUSALS.PARENT_NOT_FOUND });
        expect(await tree.slotUnder(C1, 'not-an-id')).toMatchObject({ ok: false, code: 'PARENT_NOT_FOUND' });
        expect(mockDbFor(C2).calls).toEqual([]);
    });

    test('loads every descendant by ancestors, within the company', async () => {
        seedTree(C1);
        seed(C2, CHILD, { ParentTaskId: ROOT, ancestors: [ROOT] });

        const rows = await tree.loadSubtree(C1, oid(ROOT));

        expect(rows.map((r) => String(r._id)).sort()).toEqual([CHILD, GRANDCHILD]);
        expect((await tree.loadSubtree(C1, CHILD)).map((r) => String(r._id))).toEqual([GRANDCHILD]);
        expect(await tree.loadSubtree(C1, GRANDCHILD)).toEqual([]);
        expect(mockDbFor(C2).calls).toEqual([]);
        const [call] = mockDbFor(C1).calls;
        expect(call).toMatchObject({ companyId: C1, type: SCHEMA_TYPE.TASKS, method: 'find' });
        expect(call.data[0]).toEqual({ ancestors: ROOT });
    });

    test('narrows the subtree by a filter and passes a projection', async () => {
        seedTree(C1);

        const rows = await tree.loadSubtree(C1, ROOT, { filter: { deletedStatusKey: 0 }, projection: { ancestors: 1 } });

        expect(rows.map((r) => String(r._id))).toEqual([CHILD]);
        expect(mockDbFor(C1).calls[0].data).toEqual([{ deletedStatusKey: 0, ancestors: ROOT }, { ancestors: 1 }, { lean: true }]);
    });

    test('a filter cannot widen the read past the subtree', async () => {
        seedTree(C1);

        const rows = await tree.loadSubtree(C1, ROOT, { filter: { ancestors: OTHER_ROOT } });

        expect(rows.map((r) => String(r._id)).sort()).toEqual([CHILD, GRANDCHILD]);
    });

    test('re-parenting the top rewrites the chain of every descendant and keeps updatedAt', async () => {
        seedTree(C1);
        seed(C2, GRANDCHILD, { ParentTaskId: CHILD, ancestors: [ROOT, CHILD] });

        const moved = await tree.rewriteDescendantAncestors(C1, CHILD, [OTHER_ROOT]);

        expect(moved).toBe(1);
        expect(stored(C1, GRANDCHILD).ancestors).toEqual([OTHER_ROOT, CHILD]);
        expect(stored(C1, GRANDCHILD).updatedAt).toEqual(UPDATED_AT);
        expect(stored(C1, CHILD).ancestors).toEqual([ROOT]);
        expect(stored(C1, OTHER_CHILD).ancestors).toEqual([OTHER_ROOT]);
        expect(stored(C2, GRANDCHILD).ancestors).toEqual([ROOT, CHILD]);
        const [write] = mockDbFor(C1).calls.filter((c) => c.method === 'bulkWrite');
        expect(write.data[0].every((op) => op.updateOne.timestamps === false && op.updateOne.filter.ancestors === CHILD)).toBe(true);
    });

    test('a top that becomes a task leaves its descendants one level up', async () => {
        seedTree(C1);

        const moved = await tree.rewriteDescendantAncestors(C1, oid(CHILD), []);

        expect(moved).toBe(1);
        expect(stored(C1, GRANDCHILD).ancestors).toEqual([CHILD]);
    });

    test('a top that goes one level down takes its descendants with it', async () => {
        seedTree(C1);

        await tree.rewriteDescendantAncestors(C1, OTHER_ROOT, tree.ancestorsFor(root));

        expect(stored(C1, OTHER_CHILD).ancestors).toEqual([ROOT, OTHER_ROOT]);
    });

    test('a leaf writes nothing', async () => {
        seedTree(C1);

        expect(await tree.rewriteDescendantAncestors(C1, GRANDCHILD, [OTHER_ROOT])).toBe(0);
        expect(mockDbFor(C1).calls.filter((c) => c.method === 'bulkWrite')).toEqual([]);
    });
});
