jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => {
        mockDb.reading = true;
        try { return mockDb.crud(companyId, q, method); } finally { mockDb.reading = false; }
    },
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { runNarrowed } = require('../Config/tokenNarrowing');
const { canReadTask, readableTasks } = require('../Modules/Tasks/helpers/taskReadAccess');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL } = world;
const { seed, rows, setRule } = world.create(mockDb);

const TEAMMATE = '6f0000000000000000000006';
const NO_TASK_LIST = '6f0000000000000000000007';
const STRANGER = '6f0000000000000000000009';
const TEAM = '6f0000000000000000000e01';
const DM_SPACE = '6f0000000000000000000ca1';
const CHANNEL_SPACE = '6f0000000000000000000ca2';
const P_OWN_RULES = '6f0000000000000000000a05';
const L_OWN_RULES = '6f0000000000000000000b05';
const L_TEAM = '6f0000000000000000000b06';
const GONE = '6f0000000000000000000aff';

/* Every kind of place a task row sits in. */
const PLACES = {
    'an open task': T_OPEN,
    'a task of a private list': T_SECRET,
    'a task of a private project': T_PRIVATE,
    'a task of a personal list': T_PERSONAL,
    'a task of a list private to a team': '6f0000000000000000000d11',
    'a task with no list': '6f0000000000000000000d12',
    'a task of a project with rules of its own': '6f0000000000000000000d13',
    'a task whose project is gone': '6f0000000000000000000d14',
    'a task of a private list of another project': '6f0000000000000000000d15',
    'a direct message': '6f0000000000000000000d16',
    'a conversation kept in a project': '6f0000000000000000000d17',
    'a conversation kept in a private project': '6f0000000000000000000d18',
    'a row kept in a channel space': '6f0000000000000000000d19',
    'a direct message that names a person with no seat': '6f0000000000000000000d1a',
};

/* Every standing a person asks from: [who, their id, the projects a token narrows them to]. */
const STANDINGS = [
    ['the owner', OWNER, null],
    ['an admin who is in the conversations', ADMIN, null],
    ['a member on everything private', INSIDER, null],
    ['a member', OUTSIDER, null],
    ['a member on a team a list is shared with', TEAMMATE, null],
    ['a guest', GUEST, null],
    ['a person whose role does not list tasks', NO_TASK_LIST, null],
    ['a person with no seat', STRANGER, null],
    ['the owner through a token narrowed to one project', OWNER, [P_PRIVATE]],
    ['a member who is in the conversations, through a token narrowed to one project', INSIDER, [P_PRIVATE]],
];

const seedRows = () => {
    const { seedTask, project, list } = seed();
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: TEAMMATE, roleType: 3, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: NO_TASK_LIST, roleType: 4, status: 2, isDelete: false });
    mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: TEAM, name: 'Team', assigneeUsersArray: [TEAMMATE] });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: DM_SPACE, ProjectName: 'Direct messages', default: true });
    mockDb.seed(SCHEMA_TYPE.MAIN_CHATS, { _id: CHANNEL_SPACE, ProjectName: 'Team', default: false });
    project(P_OWN_RULES, 'Own rules', { isGlobalPermission: false });
    const parent = mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task', name: 'Task', isParent: true, roles: [], projectId: P_OWN_RULES });
    mockDb.seed(SCHEMA_TYPE.PROJECT_RULES, { key: 'task_list', name: 'task_list', isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }], projectId: P_OWN_RULES });
    list(L_OWN_RULES, 'List of the project with its own rules', P_OWN_RULES);
    list(L_TEAM, 'List of a team', P_OPEN, { private: true, AssigneeUserId: [`tId_${TEAM}`] });
    const conversation = { mainChat: true, AssigneeUserId: [ADMIN, INSIDER] };
    seedTask(PLACES['a task of a list private to a team'], 'Team task', P_OPEN, L_TEAM);
    seedTask(PLACES['a task with no list'], 'Loose task', P_OPEN, undefined);
    seedTask(PLACES['a task of a project with rules of its own'], 'Ruled task', P_OWN_RULES, L_OWN_RULES);
    seedTask(PLACES['a task whose project is gone'], 'Orphan', GONE, L_OPEN);
    seedTask(PLACES['a task of a private list of another project'], 'Misfiled', P_PRIVATE, L_SECRET);
    seedTask(PLACES['a direct message'], 'Adam and Ian', DM_SPACE, L_OPEN, conversation);
    seedTask(PLACES['a conversation kept in a project'], 'Adam and Ian', P_OPEN, L_OPEN, conversation);
    seedTask(PLACES['a conversation kept in a private project'], 'Adam and Ian', P_PRIVATE, L_PRIVATE, conversation);
    seedTask(PLACES['a row kept in a channel space'], 'Pinned', CHANNEL_SPACE, L_OPEN);
    seedTask(PLACES['a direct message that names a person with no seat'], 'Adam and a leaver', DM_SPACE, L_OPEN, { mainChat: true, AssigneeUserId: [ADMIN, STRANGER] });
};

const nameOf = (id) => Object.keys(PLACES).find((name) => PLACES[name] === String(id));
const asked = (uid, narrowedTo, run) => (narrowedTo ? runNarrowed({ userId: uid, projectIds: narrowedTo }, run) : run());
const all = () => rows(SCHEMA_TYPE.TASKS).filter((task) => nameOf(task._id));

beforeEach(() => { jest.clearAllMocks(); seedRows(); });

describe('the task-read rule asked of many rows at once', () => {
    it.each(STANDINGS)('answers %s as the rule asked of each row does', async (who, uid, narrowedTo) => {
        const together = await asked(uid, narrowedTo, async () => (await readableTasks(CID, uid, all())).map((task) => nameOf(task._id)).sort());
        const oneByOne = await asked(uid, narrowedTo, async () => {
            const open = [];
            for (const task of all()) {
                if (await canReadTask(CID, uid, task)) open.push(nameOf(task._id));
            }
            return open.sort();
        });

        expect(together).toEqual(oneByOne);
    });

    it('opens what each kind of standing is known to open', async () => {
        const opens = async (uid, narrowedTo) => asked(uid, narrowedTo, async () => (await readableTasks(CID, uid, all())).map((task) => nameOf(task._id)).sort());

        expect(await opens(STRANGER)).toEqual([]);
        expect(await opens(OWNER, [P_PRIVATE])).toEqual(['a task of a private list of another project', 'a task of a private project']);
        expect(await opens(INSIDER, [P_PRIVATE])).toEqual(['a conversation kept in a private project', 'a task of a private list of another project', 'a task of a private project']);
        expect(await opens(TEAMMATE)).toContain('a task of a list private to a team');
        expect(await opens(OUTSIDER)).not.toContain('a task of a list private to a team');
        expect(await opens(NO_TASK_LIST)).toEqual([]);
        expect(await opens(ADMIN)).toContain('a direct message');
    });

    it('does work that grows with the rows, not with the rows times the places', async () => {
        const { seedTask, project, list } = seed();
        setRule('task_list', true);
        const many = (count) => {
            const made = [];
            for (let i = 0; i < count; i += 1) {
                const id = (prefix) => `${prefix}${String(i).padStart(24 - prefix.length, '0')}`;
                project(id('6f00000000000000000a2'), `Project ${i}`);
                list(id('6f00000000000000000b2'), `List ${i}`, id('6f00000000000000000a2'), i % 2 ? { private: true, AssigneeUserId: [INSIDER] } : {});
                made.push(seedTask(id('6f00000000000000000d2'), `Task ${i}`, id('6f00000000000000000a2'), id('6f00000000000000000b2')));
            }
            return made;
        };
        const stepsFor = async (tasks) => {
            const counted = { includes: Array.prototype.includes, map: Array.prototype.map };
            let steps = 0;
            /* eslint-disable no-extend-native */
            const step = (rows) => { if (!mockDb.reading) steps += rows.length; };
            Array.prototype.includes = function includes(...args) { step(this); return counted.includes.apply(this, args); };
            Array.prototype.map = function map(...args) { step(this); return counted.map.apply(this, args); };
            try {
                await readableTasks(CID, OUTSIDER, tasks);
            } finally {
                Array.prototype.includes = counted.includes;
                Array.prototype.map = counted.map;
            }
            /* eslint-enable no-extend-native */
            return steps;
        };
        const tasks = many(400);
        const small = await stepsFor(tasks.slice(0, 100));
        const large = await stepsFor(tasks);

        expect((await readableTasks(CID, OUTSIDER, tasks)).length).toBe(200);
        expect(large).toBeLessThan(small * 6);
    });
});
