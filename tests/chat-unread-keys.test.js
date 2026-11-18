const { create } = require('./fixtures/fakeMongo');

const mockDb = { current: null };
jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.current.crud(...args),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { chatUnreadKeys } = require('../Modules/MainChats/unreadKeys');

const C = '6f0000000000000000000c01';
const [ME, FRIEND, LEFT, ADMIN] = ['01', '02', '03', '04'].map((n) => `6f00000000000000000000${n}`);
const AGENT = '6f0000000000000000000a01';

let world;

beforeEach(() => {
    const db = create();
    mockDb.current = db;
    [[ME, 3], [FRIEND, 3], [ADMIN, 2]].forEach(([userId, roleType]) => db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    db.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: LEFT, roleType: 3, status: 2, isDelete: true });

    const direct = db.seed(SCHEMA_TYPE.MAIN_CHATS, { default: true });
    const channels = db.seed(SCHEMA_TYPE.MAIN_CHATS, { default: false });
    const directList = db.seed(SCHEMA_TYPE.SPRINTS, { projectId: String(direct._id), private: false });
    const list = (extra) => db.seed(SCHEMA_TYPE.SPRINTS, { projectId: String(channels._id), private: false, AssigneeUserId: [], ...extra });
    const conversation = (extra) => db.seed(SCHEMA_TYPE.TASKS, { mainChat: true, ProjectID: String(direct._id), sprintId: String(directList._id), ...extra });
    world = {
        direct,
        channels,
        directList,
        open: list({}),
        mine: list({ private: true, AssigneeUserId: [ME] }),
        theirs: list({ private: true, AssigneeUserId: [FRIEND] }),
        gone: list({ deletedStatusKey: 1 }),
        withFriend: conversation({ AssigneeUserId: [ME, FRIEND] }),
        withLeaver: conversation({ AssigneeUserId: [ME, LEFT] }),
        withAgent: conversation({ AssigneeUserId: [ME], agentId: AGENT }),
        deleted: conversation({ AssigneeUserId: [ME, FRIEND], deletedStatusKey: 1 }),
        notMine: conversation({ AssigneeUserId: [FRIEND, ADMIN] }),
    };
});

const key = (space, list, thread) => `task_${space._id}_${list._id}_${thread === 'default' ? thread : thread._id}_comments`;

describe('the conversations a chat badge counts', () => {
    it('are the person\'s live direct messages with active people or agents, and the channels they can see', async () => {
        const keys = await chatUnreadKeys(C, ME);

        expect(keys.spaces.sort()).toEqual([String(world.direct._id), String(world.channels._id)].sort());
        expect(keys.direct.sort()).toEqual([
            key(world.direct, world.directList, world.withFriend),
            key(world.direct, world.directList, world.withAgent),
        ].sort());
        expect(keys.channels.sort()).toEqual([
            key(world.channels, world.open, 'default'),
            key(world.channels, world.mine, 'default'),
        ].sort());
    });

    it('include every private channel for an admin, but never someone else\'s direct message', async () => {
        const keys = await chatUnreadKeys(C, ADMIN);

        expect(keys.channels).toContain(key(world.channels, world.theirs, 'default'));
        expect(keys.direct).toEqual([key(world.direct, world.directList, world.notMine)]);
    });
});
