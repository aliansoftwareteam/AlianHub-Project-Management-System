const mockDb = { rows: {}, seats: [] };
const mockCount = jest.fn(async () => ({ status: true }));

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: async (companyId, { type, data }, method) => {
        if (type === 'company_users' && method === 'find') {
            const asked = data[0].userId && data[0].userId.$in;
            const active = mockDb.seats.map((userId) => ({ userId }));
            return asked ? active.filter((seat) => asked.map(String).includes(seat.userId)) : active;
        }
        if (method === 'findOne') return (mockDb.rows[type] || {})[String(data[0]._id)] || null;
        return null;
    },
}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: (...a) => mockCount(...a) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { bumpUnreadCounts } = require('../Modules/Comments/helpers/unreadBumps');

const C = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000b01';
const CHATS = '6f0000000000000000000b02';
const DIRECTS = '6f0000000000000000000b03';
const SPRINT = '6f0000000000000000000d01';
const CHANNEL = '6f0000000000000000000d02';
const OPEN_CHANNEL = '6f0000000000000000000d03';
const TASK = '6f0000000000000000000e01';
const SUBTASK = '6f0000000000000000000e02';
const DM = '6f0000000000000000000e03';
const [AUTHOR, ALL, IGNORING, WATCHER, MENTIONED, TEAMMATE, DEPARTED] = ['01', '02', '03', '04', '05', '06', '07']
    .map((n) => `6f00000000000000000000${n}`);

const bumps = () => mockCount.mock.calls.map(([{ body }]) => body);
const bumpOf = (key) => bumps().filter((body) => body.key === key);

beforeEach(() => {
    mockCount.mockClear();
    mockDb.seats = [AUTHOR, ALL, IGNORING, WATCHER, MENTIONED, TEAMMATE];
    mockDb.rows = {
        [SCHEMA_TYPE.PROJECTS]: {
            [PROJECT]: { _id: PROJECT, watchers: { [ALL]: 'all_activity', [IGNORING]: 'ignore', [WATCHER]: 'participating', [AUTHOR]: 'all_activity', [DEPARTED]: 'all_activity' } },
        },
        [SCHEMA_TYPE.MAIN_CHATS]: {
            [CHATS]: { _id: CHATS, default: false },
            [DIRECTS]: { _id: DIRECTS, default: true },
        },
        [SCHEMA_TYPE.TASKS]: {
            [TASK]: { _id: TASK, watchers: [AUTHOR, WATCHER, IGNORING, TEAMMATE] },
            [SUBTASK]: { _id: SUBTASK, watchers: [TEAMMATE], ParentTaskId: TASK },
            [DM]: { _id: DM, mainChat: true, AssigneeUserId: [AUTHOR, TEAMMATE] },
        },
        [SCHEMA_TYPE.SPRINTS]: {
            [CHANNEL]: { _id: CHANNEL, private: true, AssigneeUserId: [AUTHOR, WATCHER, DEPARTED] },
            [OPEN_CHANNEL]: { _id: OPEN_CHANNEL, private: false },
        },
    };
});

const comment = (thread) => ({ _id: 'c1', userId: AUTHOR, message: 'hi', ...thread });

describe('a new comment raises the unread counts the comment panels used to raise', () => {
    it('project comment: project watchers who do not ignore it, plus the people mentioned', async () => {
        await bumpUnreadCounts(C, comment({ projectId: PROJECT }), [MENTIONED]);

        expect(bumpOf(1)).toEqual([{ companyId: C, key: 1, projectId: PROJECT, userIds: [ALL, WATCHER, MENTIONED] }]);
    });

    it('task comment: task watchers not ignoring the project, plus everyone watching all project activity', async () => {
        await bumpUnreadCounts(C, comment({ projectId: PROJECT, sprintId: SPRINT, taskId: TASK }), []);

        expect(bumpOf(2)).toEqual([{ companyId: C, key: 2, projectId: PROJECT, sprintId: SPRINT, taskId: TASK, userIds: [ALL, WATCHER, TEAMMATE] }]);
        expect(bumpOf(1)).toEqual([]);
    });

    it('subtask comment: also raises the parent task count', async () => {
        await bumpUnreadCounts(C, comment({ projectId: PROJECT, sprintId: SPRINT, taskId: SUBTASK }), []);

        expect(bumpOf(2)).toEqual([{ companyId: C, key: 2, projectId: PROJECT, sprintId: SPRINT, taskId: SUBTASK, parentTaskId: TASK, userIds: [ALL, TEAMMATE] }]);
    });

    it('direct message: the other participant', async () => {
        await bumpUnreadCounts(C, comment({ projectId: DIRECTS, sprintId: SPRINT, taskId: DM }), []);

        expect(bumps()).toEqual([{ companyId: C, key: 2, projectId: DIRECTS, sprintId: SPRINT, taskId: DM, userIds: [TEAMMATE] }]);
    });

    it('private channel: its members who are still active', async () => {
        await bumpUnreadCounts(C, comment({ projectId: CHATS, sprintId: CHANNEL, taskId: 'default' }), []);

        expect(bumps()).toEqual([{ companyId: C, key: 2, projectId: CHATS, sprintId: CHANNEL, taskId: 'default', userIds: [WATCHER] }]);
    });

    it('public channel: every active member of the company', async () => {
        await bumpUnreadCounts(C, comment({ projectId: CHATS, sprintId: OPEN_CHANNEL, taskId: 'default' }), []);

        expect(bumps()).toEqual([{ companyId: C, key: 2, projectId: CHATS, sprintId: OPEN_CHANNEL, taskId: 'default', userIds: [ALL, IGNORING, WATCHER, MENTIONED, TEAMMATE] }]);
    });

    it('raises the mention count of the people mentioned, even those who ignore the project', async () => {
        await bumpUnreadCounts(C, comment({ projectId: PROJECT, sprintId: SPRINT, taskId: TASK }), [MENTIONED, IGNORING]);

        expect(bumpOf(4)).toEqual([{ companyId: C, key: 4, userIds: [MENTIONED, IGNORING], readAll: false }]);
        expect(bumpOf(2)[0].userIds).toEqual([ALL, WATCHER, TEAMMATE, MENTIONED]);
    });

    it('raises nothing for the author alone, or for a thread that does not exist', async () => {
        mockDb.rows[SCHEMA_TYPE.TASKS][DM].AssigneeUserId = [AUTHOR];
        await bumpUnreadCounts(C, comment({ projectId: DIRECTS, sprintId: SPRINT, taskId: DM }), []);
        await bumpUnreadCounts(C, comment({ projectId: '6f0000000000000000000b09' }), []);
        await bumpUnreadCounts(C, comment({ projectId: PROJECT, sprintId: SPRINT, taskId: '6f0000000000000000000e09' }), []);

        expect(bumps()).toEqual([]);
    });
});
