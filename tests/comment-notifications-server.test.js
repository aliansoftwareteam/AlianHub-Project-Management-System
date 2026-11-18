process.env.STORAGE_TYPE = 'server';

jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: jest.fn(async () => ({ status: true })) }));
jest.mock('../Modules/notification/email-notification-handler/controllerV2', () => ({
    fetchProjectDetailsSingle: jest.fn(),
    fetchTaskDetails: jest.fn(),
}));

const { handleNotificationtFun } = require('../Modules/notification/prepare-notification-data/controllerV2');
const emailCtrl = require('../Modules/notification/email-notification-handler/controllerV2');
const { HandleBothNotification } = require('../Modules/Tasks/helpers/handleNotification');
const { mentionsEveryone } = require('../Modules/Comments/helpers/parseMentions');

const COMPANY = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000701';
const TASK = '6f0000000000000000000b01';
const LEADER = '6f0000000000000000000a01';
const WATCHER = '6f0000000000000000000a02';
const HIDDEN = '6f0000000000000000000a03';
const AUTHOR = '6f0000000000000000000a04';

const sent = () => handleNotificationtFun.mock.calls.map(([{ body }]) => body);

beforeEach(() => {
    jest.clearAllMocks();
    emailCtrl.fetchProjectDetailsSingle.mockResolvedValue([{ _id: PROJECT, watchers: { [HIDDEN]: 'all_activity' } }]);
    emailCtrl.fetchTaskDetails.mockResolvedValue([{ _id: TASK, Task_Leader: LEADER, watchers: [LEADER, WATCHER, HIDDEN] }]);
});

describe('HandleBothNotification keeps only the recipients the caller allows', () => {
    const notice = (extra) => HandleBothNotification({
        type: 'tasks',
        companyId: COMPANY,
        projectId: PROJECT,
        taskId: TASK,
        object: { key: "comments_I'm_@mentioned_in", message: 'hi' },
        userData: { id: AUTHOR },
        ...extra,
    });

    it('sends to every watcher and the task leader when no rule is given', async () => {
        await notice();
        expect(sent()).toHaveLength(1);
        expect(sent()[0].assigneeUsers.sort()).toEqual([LEADER, WATCHER, HIDDEN].sort());
        expect(sent()[0].task_leader_ID).toBe(LEADER);
    });

    it('drops the recipients the rule refuses, the task leader included', async () => {
        await notice({ keepRecipients: async (ids) => ids.filter((id) => id === WATCHER) });
        expect(sent()[0].assigneeUsers).toEqual([WATCHER]);
        expect(sent()[0].task_leader_ID).toBe('');
    });

    it('applies the rule to project notices', async () => {
        await notice({ type: 'project', taskId: undefined, userData: { id: AUTHOR, companyOwnerId: LEADER }, keepRecipients: async (ids) => ids.filter((id) => id !== HIDDEN) });
        expect(sent()[0].assigneeUsers).toEqual([LEADER]);
    });
});

describe('mentionsEveryone', () => {
    it.each([
        ['@[All](everyone) hello', true],
        ['hi @[All]( everyone ) there', true],
        ['everyone should read this', false],
        ['@[Ada](6f0000000000000000000a01)', false],
        [undefined, false],
    ])('%s -> %s', (message, expected) => {
        expect(mentionsEveryone(message)).toBe(expected);
    });
});
