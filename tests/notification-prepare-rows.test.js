jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/storage/wasabi/controller.js', () => ({ getUserProfilePresignedUrlCallBackFunction: jest.fn(async () => ({ status: false })) }));
jest.mock('../Modules/Inbox/helpers/inboxState', () => ({ wakeOnActivity: jest.fn(async () => {}) }));

const verified = require('./fixtures/verifiedRequest');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { handleNotification } = require('../Modules/notification/prepare-notification-data/controllerV2');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, P_PERSONAL, L_OPEN, L_SECRET, L_PRIVATE, L_PERSONAL, T_OPEN, T_SECRET, T_PRIVATE, T_PERSONAL, OPENS, settle } = world;
const { seed, rows } = world.create(mockDb);

const EVERYONE = [['the owner', OWNER], ['an admin', ADMIN], ['a member on everything private', INSIDER], ['a member', OUTSIDER], ['a guest', GUEST]];
const PEOPLE = EVERYONE.map(([, uid]) => uid);
const TASKS = { [T_OPEN]: [P_OPEN, L_OPEN], [T_SECRET]: [P_OPEN, L_SECRET], [T_PRIVATE]: [P_PRIVATE, L_PRIVATE], [T_PERSONAL]: [P_PERSONAL, L_PERSONAL] };
const MISSING = '6f0000000000000000000fff';

const seedRows = () => {
    seed();
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.NOTIFICATIONS_SETTINGS, {
        userId, tasks: { items: [{ key: 'task_edit', browser: true, mobile: true, email: false }] }, project: { items: [{ key: 'project_edit', browser: true, mobile: true, email: false }] },
    }));
};

const sent = async (uid, body) => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (answer) => { res.body = answer; return res; };
    res.send = res.json;
    await handleNotification(verified({ uid, headers: { companyid: CID }, params: {}, query: {}, body }), res);
    await settle();
    return { code: res.statusCode, ...res.body };
};
const aboutTask = (taskId, extra = {}) => ({ key: 'task_edit', type: 'tasks', projectId: TASKS[taskId][0], sprintId: TASKS[taskId][1], taskId, message: 'Have a look', assigneeUsers: PEOPLE, ...extra });
const written = () => rows(SCHEMA_TYPE.NOTIFICATIONS);
const receivers = () => [...new Set(written().map((row) => row.receiverID))].sort();

beforeEach(() => { jest.clearAllMocks(); seedRows(); });

describe('a notice a person sends about a task', () => {
    const cases = EVERYONE.flatMap(([who, uid]) => Object.keys(TASKS).map((taskId) => [who, uid, taskId]));

    it.each(cases)('from %s is written for the people who can open that task, when the sender can open it', async (who, uid, taskId) => {
        const answer = await sent(uid, aboutTask(taskId));
        const opens = OPENS[uid].includes(taskId);

        expect(answer.status).toBe(opens);
        expect(receivers()).toEqual(opens ? PEOPLE.filter((id) => id !== uid && OPENS[id].includes(taskId)).sort() : []);
    });

    it.each(EVERYONE)('from %s about a task they cannot open is answered like one about a task that is not there', async (who, uid) => {
        const missing = await sent(uid, aboutTask(T_OPEN, { taskId: MISSING }));
        for (const taskId of Object.keys(TASKS).filter((id) => !OPENS[uid].includes(id))) {
            expect(await sent(uid, aboutTask(taskId))).toEqual(missing);
            expect(await sent(uid, aboutTask(taskId, { projectId: P_OPEN, sprintId: L_OPEN }))).toEqual(missing);
        }
        expect(missing).toMatchObject({ code: 404, status: false });
        expect(written()).toEqual([]);
    });

    it('names the list the task is in, whatever list the request names', async () => {
        await sent(INSIDER, aboutTask(T_SECRET, { sprintId: L_OPEN }));
        expect([...new Set(written().map((row) => String(row.sprintId)))]).toEqual([L_SECRET]);
        expect(receivers()).toEqual([OWNER, ADMIN].sort());
    });

    it('about a project is written for the people who can open the project', async () => {
        await sent(INSIDER, { key: 'project_edit', type: 'project', projectId: P_PRIVATE, message: 'Have a look', assigneeUsers: PEOPLE });
        expect(receivers()).toEqual([OWNER, ADMIN].sort());
        expect((await sent(OUTSIDER, { key: 'project_edit', type: 'project', projectId: P_PRIVATE, message: 'Have a look', assigneeUsers: PEOPLE })).code).toBe(404);
    });

    it('keeps its words as text, and carries only what a person writes', async () => {
        await sent(INSIDER, aboutTask(T_OPEN, {
            message: '<img src=x onerror="go()"><b>Look</b> & see (it\'s here)', changeType: 'agent_alert', changeData: { agentName: 'Robo' }, receiverID: OWNER, notificationType: 'email',
            notSeen: PEOPLE, clearedAt: new Date(), reason: 'direct', userId: OWNER,
        }));
        const row = written().find((entry) => entry.receiverID === OUTSIDER);

        expect(row.message).toBe('&lt;img src=x onerror="go()"&gt;&lt;b&gt;Look&lt;/b&gt; &amp; see (it\'s here)');
        expect(row).toMatchObject({ userId: INSIDER, key: 'task_edit', type: 'tasks', projectId: P_OPEN, taskId: T_OPEN, notificationType: 'push' });
        expect(row.clearedAt).toBeUndefined();
        expect(row.notSeen.slice().sort()).toEqual([...PEOPLE].sort());
    });
});
