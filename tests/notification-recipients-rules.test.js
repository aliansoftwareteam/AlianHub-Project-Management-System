const mockFetch = { project: jest.fn(), task: jest.fn() };
const mockSent = jest.fn(async () => ({}));

jest.mock('../Modules/notification/email-notification-handler/controllerV2', () => ({
    fetchProjectDetailsSingle: (...a) => mockFetch.project(...a),
    fetchTaskDetails: (...a) => mockFetch.task(...a),
}));
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => ({ handleNotificationtFun: (...a) => mockSent(...a) }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { HandleBothNotification, directUsersFor } = require('../Modules/Tasks/helpers/handleNotification');

const COMPANY = '6f0000000000000000000c01';
const PROJECT = '6f0000000000000000000701';
const TASK = '6f0000000000000000000801';
const SPRINT = '6f0000000000000000000901';

const task = (over = {}) => ({ Task_Leader: 'creator', AssigneeUserId: ['asg'], LeadUserId: ['lead'], watchers: ['w1', 'w2'], ...over });
const project = (watchers = {}, over = {}) => ({ watchers, LeadUserId: ['lead'], ...over });

const notifyTask = (extra = {}) => HandleBothNotification({
    type: 'tasks', companyId: COMPANY, projectId: PROJECT, taskId: TASK, sprintId: SPRINT,
    object: { key: 'k', message: 'm' }, userData: { id: 'actor' }, ...extra,
});
const notifyProject = (extra = {}) => HandleBothNotification({
    type: 'project', companyId: COMPANY, projectId: PROJECT,
    object: { key: 'k', message: 'm' }, userData: { id: 'actor', companyOwnerId: 'owner' }, ...extra,
});
const sentBody = () => mockSent.mock.calls[0][0].body;

beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.project.mockResolvedValue([project()]);
    mockFetch.task.mockResolvedValue([task()]);
});

describe('directUsersFor', () => {
    it('names the people a task update is about, once each', () => {
        const out = directUsersFor({ type: 'task', taskData: { Task_Leader: 'a', AssigneeUserId: ['b', 'a'], LeadUserId: 'c' }, mentionUserId: ['d', 'b'] });
        expect(out.sort()).toEqual(['a', 'b', 'c', 'd']);
    });

    it('names the project lead and the people mentioned for a project', () => {
        expect(directUsersFor({ type: 'project', projectData: { LeadUserId: ['l'] }, mentionUserId: ['m'] }).sort()).toEqual(['l', 'm']);
    });

    it('has no split for other kinds, and copes with missing data', () => {
        expect(directUsersFor({ type: 'chat' })).toBeUndefined();
        expect(directUsersFor()).toBeUndefined();
        expect(directUsersFor({ type: 'tasks' })).toEqual([]);
    });
});

describe('who a task update reaches', () => {
    it('reaches the creator and the task watchers, not the assignees who are not watching', async () => {
        await expect(notifyTask()).resolves.toEqual({ status: true });
        expect(sentBody().assigneeUsers.sort()).toEqual(['creator', 'w1', 'w2']);
        expect(sentBody().notSeen).toEqual(sentBody().assigneeUsers);
        expect(sentBody().task_leader_ID).toBe('creator');
    });

    it('does not tell the creator twice when they also watch', async () => {
        mockFetch.task.mockResolvedValue([task({ watchers: ['creator', 'w1'] })]);
        await notifyTask();
        expect(sentBody().assigneeUsers.sort()).toEqual(['creator', 'w1']);
    });

    it('leaves out a watcher who set the project to ignore', async () => {
        mockFetch.project.mockResolvedValue([project({ w1: 'ignore' })]);
        await notifyTask();
        expect(sentBody().assigneeUsers.sort()).toEqual(['creator', 'w2']);
    });

    it('leaves out the creator when they set the project to ignore', async () => {
        mockFetch.project.mockResolvedValue([project({ creator: 'ignore' })]);
        await notifyTask();
        expect(sentBody().assigneeUsers).not.toContain('creator');
        expect(sentBody().assigneeUsers.sort()).toEqual(['w1', 'w2']);
    });

    it('rejects with "No watchers" when everyone watching ignores the project', async () => {
        mockFetch.project.mockResolvedValue([project({ w1: 'ignore', w2: 'ignore' })]);
        await expect(notifyTask()).rejects.toEqual({ status: false, message: 'No watchers' });
        expect(mockSent).not.toHaveBeenCalled();
    });

    it('rejects with "No watchers" when the task has none', async () => {
        mockFetch.task.mockResolvedValue([task({ watchers: [] })]);
        await expect(notifyTask()).rejects.toMatchObject({ message: 'No watchers' });
    });

    it('keeps only the recipients the caller allows, and clears the leader when they are dropped', async () => {
        await notifyTask({ keepRecipients: async (ids) => ids.filter((id) => id === 'w1') });
        expect(sentBody().assigneeUsers).toEqual(['w1']);
        expect(sentBody().task_leader_ID).toBe('');
    });

    it('marks who the update is directly about', async () => {
        await notifyTask({ mentionUserId: ['m1'] });
        expect(sentBody().directUsers.sort()).toEqual(['asg', 'creator', 'lead', 'm1']);
    });

    it('rejects with the reason when sending fails', async () => {
        mockSent.mockRejectedValueOnce(new Error('queue down'));
        await expect(notifyTask()).rejects.toEqual({ status: false, message: 'queue down' });
    });

    it('asks for the task and project of the company named', async () => {
        await notifyTask();
        expect(mockFetch.task).toHaveBeenCalledWith(COMPANY, TASK);
        expect(mockFetch.project).toHaveBeenCalledWith(COMPANY, PROJECT);
        expect(sentBody().companyId).toBe(COMPANY);
    });

    it('still sends when the project cannot be read', async () => {
        mockFetch.project.mockRejectedValue(new Error('db down'));
        await expect(notifyTask()).resolves.toEqual({ status: true });
    });

    it('rejects when the task cannot be read', async () => {
        mockFetch.task.mockRejectedValue(new Error('db down'));
        await expect(notifyTask()).rejects.toMatchObject({ status: false });
    });
});

describe('who a project update reaches', () => {
    it('reaches those watching all activity and the company owner', async () => {
        mockFetch.project.mockResolvedValue([project({ a: 'all_activity', b: 'ignore', c: 'participating_mentions' })]);
        await notifyProject();
        expect(sentBody().assigneeUsers.sort()).toEqual(['a', 'owner']);
    });

    it('reaches a participating watcher only when mentioned', async () => {
        mockFetch.project.mockResolvedValue([project({ c: 'participating_mentions' })]);
        await notifyProject({ mentionUserId: ['c'] });
        expect(sentBody().assigneeUsers).toContain('c');
    });

    it('leaves out the owner when they set the project to ignore', async () => {
        mockFetch.project.mockResolvedValue([project({ owner: 'ignore', a: 'all_activity' })]);
        await notifyProject();
        expect(sentBody().assigneeUsers).toEqual(['a']);
    });

    it('does not tell the owner twice', async () => {
        mockFetch.project.mockResolvedValue([project({ owner: 'all_activity' })]);
        await notifyProject();
        expect(sentBody().assigneeUsers).toEqual(['owner']);
    });

    it('rejects when the project does not exist', async () => {
        mockFetch.project.mockResolvedValue([]);
        await expect(notifyProject()).rejects.toMatchObject({ status: false });
        expect(mockSent).not.toHaveBeenCalled();
    });
});

describe('who a chat message reaches', () => {
    const chat = (extra = {}) => HandleBothNotification({
        type: 'chat', companyId: COMPANY, projectId: PROJECT, taskId: TASK, sprintId: SPRINT,
        object: { key: 'k', message: 'm' }, userData: { id: 'actor' }, ...extra,
    });

    it('reaches the task creator and everyone watching the task', async () => {
        await chat();
        expect(sentBody().assigneeUsers.sort()).toEqual(['creator', 'w1', 'w2']);
        expect(sentBody().taskId).toBe(TASK);
    });

    it('falls back to the assignees when the task has no creator', async () => {
        mockFetch.task.mockResolvedValue([task({ Task_Leader: '', AssigneeUserId: ['asg'], watchers: ['w1'] })]);
        await chat();
        expect(sentBody().assigneeUsers.sort()).toEqual(['asg', 'w1']);
    });

    it('rejects with "No watchers" when nobody is watching', async () => {
        mockFetch.task.mockResolvedValue([task({ watchers: [] })]);
        await expect(chat()).rejects.toMatchObject({ message: 'No watchers' });
    });
});

describe('anything else', () => {
    it('says there was nothing to notify', async () => {
        await expect(HandleBothNotification({ type: 'sprint', object: {}, userData: {} })).rejects.toMatchObject({ status: false, message: expect.stringContaining('Nothing to notify') });
    });
});
