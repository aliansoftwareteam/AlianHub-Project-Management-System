const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Modules/Comments/helpers/threadWriteAccess', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/threadWriteAccess'),
    canPostToThread: jest.fn(async () => ({ allowed: true, match: {} })),
}));
jest.mock('../Modules/Comments/helpers/threadAccess', () => ({
    commentThreadAccess: jest.fn(async (companyId, uid) => ({ allowed: uid !== '6f0000000000000000000d03' })),
}));
jest.mock('../Modules/Comments/helpers/commentNotifications', () => ({
    ...jest.requireActual('../Modules/Comments/helpers/commentNotifications'),
    deliverMentions: jest.fn(async () => []),
}));
jest.mock('../Modules/Agents/triggers', () => ({ fromComment: jest.fn(async () => null) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({
    forStatusChange: jest.fn(async () => null),
    recordWork: jest.fn(async () => null),
}));
jest.mock('../Modules/Agents/permissions', () => ({ holderMay: jest.fn(async () => ({ allowed: true, reason: '' })) }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { deliverMentions } = require('../Modules/Comments/helpers/commentNotifications');
const actions = require('../Modules/Agents/actions');
const manageTools = require('../Modules/Mcp/manageTools');

const CID = '6a8ee973d625fca52e519a12';
const TASK_ID = '6f0000000000000000000701';
const PROJECT_ID = '6a9954186dd786246031e47b';
const OWNER = '6f0000000000000000000d01';
const LOCAL_PM = '6f0000000000000000000d02';
const OUTSIDER = '6f0000000000000000000d03';
const ELSEWHERE = '6f0000000000000000000d04';

const ownersClaude = { kind: 'agent', userId: OWNER, agentId: '', agentName: 'Claude', viaAccount: 'personal' };
const comment = (body) => actions.perform({ companyId: CID, actor: ownersClaude, action: 'task.comment', params: { taskId: TASK_ID, body, notifyMentions: true } });
const stored = () => (mockDb.store[SCHEMA_TYPE.COMMENTS] || [])[0];

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.TASKS, { _id: TASK_ID, CompanyId: CID, ProjectID: PROJECT_ID, TaskName: 'Sandbox', TaskKey: 'QAS-169' });
    [OWNER, LOCAL_PM, OUTSIDER].forEach((userId) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, status: 2 }));
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OWNER, Employee_Name: 'Mevil Owner' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: LOCAL_PM, Employee_Name: 'Local PM' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: OUTSIDER, Employee_Name: 'Guest Reviewer' });
    mockDb.seed(SCHEMA_TYPE.USERS, { _id: ELSEWHERE, Employee_Name: 'Other Company' });
});

describe('a mention in an agent task comment reaches the person', () => {
    it.each([
        ['the editor markup', `Please check @[Local PM](${LOCAL_PM}).`],
        ['a display name with a space', 'Please check @Local PM.'],
        ['a name in brackets', 'Please check @[local pm].'],
        ['a bare member id', `Please check @${LOCAL_PM}.`],
    ])('%s notifies them through the web comment notice path', async (form, body) => {
        const { result } = await comment(body);

        expect(result.mentioned).toEqual([{ userId: LOCAL_PM, name: 'Local PM' }]);
        expect(result.notNotified).toEqual([]);
        expect(stored().message).toBe(`Please check @[Local PM](${LOCAL_PM}).`);
        expect(stored().mentionIds).toEqual([LOCAL_PM]);
        expect(deliverMentions).toHaveBeenCalledWith(CID, expect.objectContaining({ _id: stored()._id }), [LOCAL_PM]);
    });

    it('a person who cannot open the task is not notified, and the answer says so', async () => {
        const { result } = await comment('@Local PM and @Guest Reviewer, a look please');

        expect(result.mentioned).toEqual([{ userId: LOCAL_PM, name: 'Local PM' }]);
        expect(result.notNotified).toEqual([{ userId: OUTSIDER, name: 'Guest Reviewer', reason: expect.stringContaining('cannot open') }]);
        expect(deliverMentions).toHaveBeenCalledWith(CID, expect.anything(), [LOCAL_PM]);
    });

    it('a person outside this company is never matched, and a name no one has is reported', async () => {
        const { result } = await comment(`@[Other Company](${ELSEWHERE}) and @Nobody Here`);

        expect(result.mentioned).toEqual([]);
        expect(result.notFound).toEqual(expect.arrayContaining([ELSEWHERE, 'Nobody']));
        expect(deliverMentions).not.toHaveBeenCalled();
    });

    it('an ordinary link and an email address are not mentions', async () => {
        const { result } = await comment('See [docs](https://example.com) or write to pm@example.com');

        expect(result.mentioned).toEqual([]);
        expect(result.notFound).toEqual([]);
        expect(stored().message).toBe('See [docs](https://example.com) or write to pm@example.com');
    });

    it.each(['@Local PM, steps please', `@[Local PM](${LOCAL_PM}), steps please`])('naming the person the comment is written for (%s) says they were not told', async (body) => {
        const pm = { ...ownersClaude, userId: LOCAL_PM };
        const { result } = await actions.perform({ companyId: CID, actor: pm, action: 'task.comment', params: { taskId: TASK_ID, body, notifyMentions: true } });

        expect(result).toEqual(expect.objectContaining({ mentioned: [], notNotified: [{ userId: LOCAL_PM, name: 'Local PM', reason: expect.stringMatching(/is you/) }], notFound: [] }));
        expect(deliverMentions).not.toHaveBeenCalled();
    });

    it('naming yourself beside someone else tells them and says only that you were not notified', async () => {
        const { result } = await comment(`@${OWNER} and @[Local PM](${LOCAL_PM}), steps please`);

        expect(result.mentioned).toEqual([{ userId: LOCAL_PM, name: 'Local PM' }]);
        expect(result.notNotified).toEqual([{ userId: OWNER, name: expect.any(String), reason: 'is you, the person this comment is written for, so you were not notified' }]);
    });

    const plainTools = [...require('../Modules/Mcp/tools').TOOLS, ...require('../Modules/Mcp/dataTools').TOOLS];
    it.each([
        ['task.comment', plainTools.find((t) => t.name === 'task.comment')],
        ['task.comment, managing', manageTools.VARIANTS['task.comment']],
        ['comment.create, managing', manageTools.VARIANTS['comment.create']],
        ['comment.create', plainTools.find((t) => t.name === 'comment.create')],
    ])('the %s tool notifies and its description names every form the parser accepts and what the answer lists', (name, tool) => {
        ['@[Their Name](their member id)', '@Their Name', 'members.list', 'mentioned', 'notNotified', 'notFound'].forEach((part) => expect(tool.description).toContain(part));
        expect(tool.params({ taskId: TASK_ID, body: 'x', text: 'x' })).toMatchObject({ notifyMentions: true });
    });
});
