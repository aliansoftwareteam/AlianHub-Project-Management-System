/* Every method of the task mixins can be named as an action by a request. An action is safe to dispatch only
 * when it has a row in the permission table and a row in the field table that says which task, list and
 * project it writes; this fails the build when a new method has neither. */
process.env.STORAGE_TYPE = 'server';

jest.mock('../../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(), validateObjectId: jest.fn() }));
jest.mock('../../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0 } }));
jest.mock('../../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, { get: (target, name) => { target[name] = target[name] || jest.fn(); return target[name]; } });
jest.mock('../../Modules/Sprints/controller', () => mockStub());
jest.mock('../../Modules/Tasks/helpers/mongo_helper', () => mockStub());
jest.mock('../../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../../Modules/Company/eventController', () => mockStub());
jest.mock('../../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../../common-storage/common-server.js', () => mockStub());

const { TASK_ACTIONS } = require('../../Config/taskWritePermissions');
const { TASK_ACTION_FIELDS, PLACEMENT_FIELDS } = require('../../Modules/Tasks/helpers/taskWriteFields');
const { taskMongo } = require('../../Modules/Tasks/helpers/task_class_Mongo');

/* Methods the handlers call on each other. The routes refuse each as an action, because none has a field row. */
const HELPERS = ['updateTaskKey', 'updateParentCount', 'updateTaskIndex', 'findRelationTask', 'pushRelationEntry', 'pullRelationEntry', 'addRelationHistory', 'removeRelationHistory', 'notifyRelationChange', '_bulkArchiveDelete'];
/* These read the task and the list from the database and judge both themselves. */
const PLACED_BY_HANDLER = ['addToList', 'removeFromList', 'bulkAddToList'];
/* The list this one writes into is the one it makes. */
const MAKES_ITS_LIST = ['convertToList'];
/* Its tasks may sit in several projects and lists, so the handler reads what each leaves from the task. */
const LEFT_READ_PER_TASK = ['bulkDuplicate'];

const methodsOf = (instance) => Object.getOwnPropertyNames(Object.getPrototypeOf(instance)).filter((name) => name !== 'constructor' && typeof instance[name] === 'function');
const has = (table, name) => Object.hasOwn(table, name);
const pathName = (path) => path.join('.');

const unplaced = (methods, { permissions = TASK_ACTIONS, fields = TASK_ACTION_FIELDS, helpers = HELPERS } = {}) => methods.flatMap((method) => {
    const missing = [];
    if (!has(permissions, method)) missing.push(`${method} has no row in the permission table`);
    if (!has(fields, method) && !helpers.includes(method)) missing.push(`${method} has no row in the field table and is not a named helper`);
    if (has(fields, method) && helpers.includes(method)) missing.push(`${method} is named a helper and has a field row`);
    return missing;
});

describe('the task dispatch table, the permission table and the field table agree', () => {
    const methods = methodsOf(taskMongo);
    const actions = Object.keys(TASK_ACTION_FIELDS);
    const placing = actions.filter((action) => TASK_ACTION_FIELDS[action].owns.some((field) => PLACEMENT_FIELDS.includes(field)));

    test('the scan sees the dispatch table (it is not vacuous)', () => {
        expect(methods.length).toBeGreaterThan(50);
        expect(methods).toEqual(expect.arrayContaining(['create', 'moveTask', 'bulkMove', 'addToList', 'updateTaskKey']));
        expect(placing).toEqual(expect.arrayContaining(['create', 'moveTask', 'duplicateTask', 'convertToSubTask', 'bulkMove']));
    });

    test('every method has a permission row, and a field row unless it is a named helper', () => {
        expect(unplaced(methods)).toEqual([]);
    });

    test('a method added with no row is reported', () => {
        expect(unplaced([...methods, 'updateSomethingNew'])).toEqual([
            'updateSomethingNew has no row in the permission table',
            'updateSomethingNew has no row in the field table and is not a named helper',
        ]);
    });

    test('every action and every named helper is a method of the dispatch table', () => {
        expect([...actions, ...HELPERS, ...PLACED_BY_HANDLER, ...MAKES_ITS_LIST, ...LEFT_READ_PER_TASK].filter((name) => !methods.includes(name))).toEqual([]);
    });

    test.each(actions)('%s names the task it writes, the tasks it lists or the project it writes into', (action) => {
        const { task, listed, destination } = TASK_ACTION_FIELDS[action];

        expect(Boolean(task || listed || destination) || PLACED_BY_HANDLER.includes(action)).toBe(true);
    });

    test.each(placing)('%s, which places a task, names the list of a project or the task it goes under', (action) => {
        const { destination, list, others } = TASK_ACTION_FIELDS[action];

        expect(destination ? Boolean(list) || MAKES_ITS_LIST.includes(action) : others.length > 0).toBe(true);
    });

    test.each(actions.filter((action) => TASK_ACTION_FIELDS[action].parent))('%s, which takes a parent, lands in a project the caller opens', (action) => {
        expect(TASK_ACTION_FIELDS[action].destination).toBeTruthy();
    });

    test.each(actions.filter((action) => TASK_ACTION_FIELDS[action].lands))('%s lands in the project of a task the caller reads', (action) => {
        const { lands, others, destination } = TASK_ACTION_FIELDS[action];

        expect(others.map(pathName)).toContain(pathName(lands));
        expect(destination).toBeNull();
    });

    test.each(actions.filter((action) => TASK_ACTION_FIELDS[action].params.includes('oldProject')))('%s rebuilds the project a task leaves from the stored rows', (action) => {
        const { task, mapping, rules, destination, lands } = TASK_ACTION_FIELDS[action];
        const rebuilt = Boolean(task) && [mapping, rules].filter(Boolean).map(pathName).includes('oldProject') && Boolean(destination || lands);

        expect(rebuilt || LEFT_READ_PER_TASK.includes(action)).toBe(true);
    });

    test.each(actions.filter((action) => TASK_ACTION_FIELDS[action].params.includes('oldSprintObj')))('%s rebuilds the list a task leaves from the stored task', (action) => {
        const { task, leaves } = TASK_ACTION_FIELDS[action];

        expect((Boolean(task) && leaves.map(pathName).includes('oldSprintObj')) || LEFT_READ_PER_TASK.includes(action)).toBe(true);
    });
});
