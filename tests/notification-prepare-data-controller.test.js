const mockSettings = jest.fn();
const mockUsers = jest.fn();
const mockCount = jest.fn();
const mockWasabi = jest.fn();
const mockWake = jest.fn();
const mockCanRead = jest.fn();
const mockOpensThread = jest.fn();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Config/config.js', () => ({}));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/notification/prepare-notification-data/settings-controllerV2', () => ({ getNotificationSetttings: (...a) => mockSettings(...a) }));
jest.mock('../Modules/notification/prepare-notification-data/user-controllerV2', () => ({ getUsersDetails: (...a) => mockUsers(...a) }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: (...a) => mockCount(...a) }));
jest.mock('../Modules/storage/wasabi/controller.js', () => ({ getUserProfilePresignedUrlCallBackFunction: (...a) => mockWasabi(...a) }));
jest.mock('../Modules/Inbox/helpers/inboxState', () => ({ wakeOnActivity: (...a) => mockWake(...a) }));
jest.mock('../event/socketEventEmitter.js', () => ({ emit: jest.fn() }));
jest.mock('../Config/projectAccess', () => ({ canReadProject: (...a) => mockCanRead(...a) }));
jest.mock('../Modules/Comments/helpers/threadAccess', () => ({ commentThreadAccess: (...a) => mockOpensThread(...a) }));

const verified = require('./fixtures/verifiedRequest');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const logger = require('../Config/loggerConfig');
const socketEmitter = require('../event/socketEventEmitter.js');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const ctrl = require('../Modules/notification/prepare-notification-data/controllerV2');

const C = '6f0000000000000000000c01';
const OTHER_C = '6f0000000000000000000c02';
const ME = '6f0000000000000000000001';
const BOB = '6f0000000000000000000002';
const EVE = '6f0000000000000000000003';
const LEAD = '6f0000000000000000000004';
const PROJECT = '6f0000000000000000000701';
const HIDDEN_PROJECT = '6f0000000000000000000702';
const TASK = '6f0000000000000000000801';
const LIST = '6f0000000000000000000901';
const OTHER_LIST = '6f0000000000000000000902';
const MENTION = "comments_I'm_@mentioned_in";

const flush = () => new Promise((resolve) => setTimeout(resolve, 25));
const reply = () => {
    const res = { statusCode: 200 };
    res.status = (code) => { res.statusCode = code; return res; };
    res.send = (body) => { res.body = body; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
};
const validBody = (over = {}) => ({ key: 'task_status', type: 'tasks', companyId: C, projectId: PROJECT, taskId: TASK, message: 'moved', userId: ME, assigneeUsers: [BOB], ...over });
const setting = (userId, key, flags) => ({ userId, tasks: { items: [{ key, browser: false, mobile: false, email: false, ...flags }] } });
const user = (id, over = {}) => ({ _id: id, Employee_Email: `${id}@x.io`, Employee_Name: `Name ${id}`, Employee_profileImage: `${id}.png`, webTokens: [`tok-${id}`], isEmailVerified: true, ...over });

const savedTo = (scope) => MongoDbCrudOpration.mock.calls.filter((c) => c[0] === scope && c[2] === 'save').map((c) => c[1].data);

let seats;
let readers;
/* The people who can open the list or task a notice names; everyone who can open its project, unless a case says otherwise. */
let threadReaders;
beforeEach(() => {
    jest.clearAllMocks();
    seats = [ME, BOB, LEAD];
    readers = { [PROJECT]: [ME, BOB, EVE, LEAD], [HIDDEN_PROJECT]: [BOB] };
    threadReaders = null;
    mockCanRead.mockImplementation(async (companyId, uid, projectId) => ({ allowed: companyId === C && (readers[projectId] || []).includes(String(uid)) }));
    mockOpensThread.mockImplementation(async (companyId, uid, thread) => ({ allowed: companyId === C && (threadReaders || readers[thread.projectId] || []).includes(String(uid)) }));
    MongoDbCrudOpration.mockImplementation(async (scope, obj, method) => {
        if (method === 'findOne' && obj.type === SCHEMA_TYPE.TASKS) return { _id: TASK, sprintId: LIST };
        if (method === 'find' && obj.type === SCHEMA_TYPE.COMPANY_USERS) {
            const wanted = obj.data[0].userId.$in;
            return wanted.filter((id) => seats.includes(id)).map((userId) => ({ userId }));
        }
        if (method === 'save') return { id: 'n1' };
        return null;
    });
    mockSettings.mockResolvedValue([]);
    mockUsers.mockResolvedValue([user(ME), user(BOB), user(EVE), user(LEAD)]);
    mockCount.mockResolvedValue({});
    mockWasabi.mockResolvedValue({ status: true, statusText: 'https://img/signed' });
    mockWake.mockResolvedValue(undefined);
});

describe('handleNotification (the HTTP entry)', () => {
    const post = async (req) => {
        const res = reply();
        await ctrl.handleNotification(verified({ headers: { companyid: C }, uid: ME, body: validBody(), ...req }), res);
        return res;
    };

    it('refuses a signed-out caller with 403 and does nothing', async () => {
        const res = await post({ aud: undefined, uid: undefined });
        expect(res.statusCode).toBe(403);
        expect(res.body).toEqual({ status: false, statusText: expect.any(String) });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        expect(mockSettings).not.toHaveBeenCalled();
    });

    it('refuses a caller whose token is for a different company', async () => {
        const res = await post({ aud: OTHER_C });
        expect(res.statusCode).toBe(403);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses a request without a valid companyid header', async () => {
        for (const companyid of [undefined, 'not-an-id', '']) {
            const res = await post({ headers: { companyid }, aud: C, body: { ...validBody(), companyId: undefined } });
            expect(res.statusCode).toBe(403);
        }
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('refuses a body that names a different company than the header', async () => {
        const res = await post({ body: validBody({ companyId: OTHER_C }) });
        expect(res.statusCode).toBe(403);
        expect(res.body.statusText).toMatch(/more than one company/);
        expect(mockSettings).not.toHaveBeenCalled();
    });

    it('answers key, message and task errors in the body, like the inner function', async () => {
        expect((await post({ body: validBody({ key: '' }) })).body).toEqual({ status: false, message: 'key is required.' });
        expect((await post({ body: validBody({ message: '' }) })).body).toEqual({ status: false, message: 'message is required.' });
        expect((await post({ body: validBody({ key: 'tasks', taskId: '' }) })).body).toEqual({ status: false, message: 'taskId is required.' });
        expect(mockSettings).not.toHaveBeenCalled();
    });

    it.each([
        ['an empty project', { projectId: '' }],
        ['a project that is not text', { projectId: { $ne: '' } }],
        ['a project the caller cannot open', { projectId: HIDDEN_PROJECT }],
    ])('answers 404 for %s, reading no seats and notifying nobody', async (_name, over) => {
        const res = await post({ body: validBody(over) });
        await flush();
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ status: false, message: 'Project not found.' });
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        expect(mockSettings).not.toHaveBeenCalled();
    });

    it('asks whether the signed-in person can open the project, in the caller\'s company', async () => {
        await post({ body: validBody({ userId: BOB }) });
        expect(mockCanRead.mock.calls[0]).toEqual([C, ME, PROJECT]);
    });

    it('treats a body that is not an object as empty: no project, so 404', async () => {
        const res = await post({ body: 'oops' });
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ status: false, message: 'Project not found.' });
        expect(mockSettings).not.toHaveBeenCalled();
    });

    it('takes the sender from the session, whatever the body claims', async () => {
        mockSettings.mockResolvedValue([setting(BOB, 'task_status', { browser: true })]);
        const res = await post({ body: validBody({ userId: BOB, assigneeUsers: [BOB, ME] }) });
        await flush();
        expect(res.body).toEqual({ status: true, message: 'create notification data' });
        expect(mockSettings).toHaveBeenCalledWith([BOB], C);
        expect(savedTo(C)[0]).toMatchObject({ userId: ME, receiverID: BOB });
    });

    it('looks up seats for the claimed assignees and leader in the caller\'s company', async () => {
        await post({ body: validBody({ assigneeUsers: [BOB, EVE], task_leader_ID: LEAD }) });
        const find = MongoDbCrudOpration.mock.calls.find((c) => c[2] === 'find' && c[1].type === SCHEMA_TYPE.COMPANY_USERS);
        expect(find[0]).toBe(C);
        expect(find[1].data[0].userId.$in.sort()).toEqual([BOB, EVE, LEAD].sort());
    });

    it('drops assignees who hold no active seat in the company and keeps the rest once each', async () => {
        await post({ body: validBody({ assigneeUsers: [BOB, EVE, BOB] }) });
        await flush();
        expect(mockSettings).toHaveBeenCalledWith([BOB], C);
    });

    it('drops members who cannot open the project, assignee or leader', async () => {
        readers[PROJECT] = [ME, BOB];
        await post({ body: validBody({ assigneeUsers: [BOB, LEAD], task_leader_ID: LEAD }) });
        await flush();
        expect(mockSettings).toHaveBeenCalledTimes(1);
        expect(mockSettings).toHaveBeenCalledWith([BOB], C);
    });

    it('answers 404 for a list or task the caller cannot open, as for a project, reading no seats and notifying nobody', async () => {
        threadReaders = [BOB];
        const res = await post({});
        await flush();
        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ status: false, message: 'Project not found.' });
        expect(MongoDbCrudOpration.mock.calls.filter((c) => c[1].type === SCHEMA_TYPE.COMPANY_USERS)).toEqual([]);
        expect(mockSettings).not.toHaveBeenCalled();
    });

    it('drops members who can open the project but not the list or task', async () => {
        threadReaders = [ME, BOB];
        await post({ body: validBody({ assigneeUsers: [BOB, EVE, LEAD], task_leader_ID: LEAD }) });
        await flush();
        expect(mockSettings).toHaveBeenCalledTimes(1);
        expect(mockSettings).toHaveBeenCalledWith([BOB], C);
    });

    it('names the list the task is stored in, whatever list the request names, and asks about that one', async () => {
        mockSettings.mockResolvedValue([setting(BOB, 'task_status', { browser: true })]);
        await post({ body: validBody({ sprintId: OTHER_LIST }) });
        await flush();
        expect(mockOpensThread.mock.calls.every(([, , thread]) => thread.sprintId === LIST && thread.taskId === TASK && thread.projectId === PROJECT)).toBe(true);
        expect(savedTo(C)[0]).toMatchObject({ projectId: PROJECT, taskId: TASK, sprintId: LIST });
    });

    it('keeps the words as text, so nothing in them is read as markup', async () => {
        mockSettings.mockResolvedValue([setting(BOB, 'task_status', { browser: true })]);
        await post({ body: validBody({ message: '<img src=x onerror="go()"><b>Look</b> & see (it\'s here)' }) });
        await flush();
        expect(savedTo(C)[0].message).toBe('&lt;img src=x onerror="go()"&gt;&lt;b&gt;Look&lt;/b&gt; &amp; see (it\'s here)');
    });

    it('builds the notice from the listed fields only, leaving out the ones the server fills in', async () => {
        mockSettings.mockResolvedValue([setting(BOB, 'task_status', { browser: true })]);
        await post({ body: validBody({ receiverID: EVE, notificationType: 'email', isSeen: true, Employee_Email: 'x@example.test', changeData: ['a'] }) });
        await flush();
        const saved = savedTo(C)[0];
        expect(saved).toMatchObject({ userId: ME, receiverID: BOB, notificationType: 'push', isSeen: false, companyId: C, changeData: {} });
        expect(saved.Employee_Email).toBe(`${BOB}@x.io`);
    });

    it('drops a leader who holds no seat and adds an active one to the receivers', async () => {
        await post({ body: validBody({ assigneeUsers: [BOB], task_leader_ID: EVE }) });
        await flush();
        expect(mockSettings).toHaveBeenLastCalledWith([BOB], C);

        mockSettings.mockClear();
        await post({ body: validBody({ assigneeUsers: [BOB], task_leader_ID: LEAD }) });
        await flush();
        expect(mockSettings).toHaveBeenLastCalledWith([BOB, LEAD], C);
    });

    it('copes with assigneeUsers that is not a list', async () => {
        const res = await post({ body: validBody({ assigneeUsers: 'bob' }) });
        await flush();
        expect(res.body).toEqual({ status: true, message: 'create notification data' });
        expect(mockSettings).toHaveBeenCalledWith([], C);
    });

    it('answers with the rejection when the seat lookup fails', async () => {
        const failure = new Error('seat db down');
        MongoDbCrudOpration.mockRejectedValue(failure);
        const res = await post({});
        expect(res.body).toBe(failure);
    });
});

describe('handleNotificationtFun', () => {
    const run = (body) => ctrl.handleNotificationtFun({ body });

    it('asks for each required field in turn', async () => {
        expect(await run(undefined)).toEqual({ status: false, message: 'key is required.' });
        expect(await run(validBody({ companyId: '' }))).toEqual({ status: false, message: 'companyId is required.' });
        expect(await run(validBody({ projectId: undefined }))).toEqual({ status: false, message: 'projectId is required.' });
        expect(await run(validBody({ message: '' }))).toEqual({ status: false, message: 'message is required.' });
        expect(await run(validBody({ userId: null }))).toEqual({ status: false, message: 'userId is required.' });
        expect(await run(validBody({ key: 'tasks', taskId: undefined }))).toEqual({ status: false, message: 'taskId is required.' });
        expect(mockSettings).not.toHaveBeenCalled();
    });

    it('accepts and queues the work for a valid body', async () => {
        expect(await run(validBody())).toEqual({ status: true, message: 'create notification data' });
        await flush();
        expect(mockSettings).toHaveBeenCalledWith([BOB], C);
    });

    it('adds the task leader to the receivers once', async () => {
        await run(validBody({ assigneeUsers: [BOB], task_leader_ID: LEAD }));
        await run(validBody({ assigneeUsers: [BOB, LEAD], task_leader_ID: LEAD }));
        await flush();
        expect(mockSettings.mock.calls.map((c) => c[0])).toEqual([[BOB, LEAD], [BOB, LEAD]]);
    });

    it('ignores an empty leader', async () => {
        await run(validBody({ assigneeUsers: [BOB], task_leader_ID: '' }));
        await flush();
        expect(mockSettings).toHaveBeenCalledWith([BOB], C);
    });

    it('sends a project notification to no one when nobody is named, since only assignees receive it', async () => {
        await run(validBody({ key: 'project', type: 'project', assigneeUsers: undefined }));
        await flush();
        expect(mockSettings).toHaveBeenCalledWith([], C);
    });

    it('logs a failure in the background and still answered ok', async () => {
        mockSettings.mockRejectedValue({ message: 'settings gone' });
        expect(await run(validBody())).toEqual({ status: true, message: 'create notification data' });
        await flush();
        expect(logger.error).toHaveBeenCalledWith('Prepare Notification Handler of single notification Catch error: settings gone');
    });
});

describe('handleSingleNotification', () => {
    it('does not look up settings for the sender', async () => {
        await ctrl.handleSingleNotification({ ...validBody(), assigneeUsers: [ME, BOB] });
        expect(mockSettings).toHaveBeenCalledWith([BOB], C);
    });

    it('looks up no one when nobody is named', async () => {
        await ctrl.handleSingleNotification({ ...validBody(), assigneeUsers: undefined });
        expect(mockSettings).toHaveBeenCalledWith([], C);
    });

    it('rejects with the message when the settings cannot be read', async () => {
        mockSettings.mockRejectedValue(new Error('no settings'));
        await expect(ctrl.handleSingleNotification(validBody())).rejects.toEqual({ message: 'no settings' });
    });
});

describe('manageNotificationSettings', () => {
    const manage = (body, settings) => ctrl.manageNotificationSettings({ ...validBody(), ...body }, settings);

    it('answers nothing when there are no settings', async () => {
        expect(await manage({}, [])).toEqual([]);
        expect(mockUsers).not.toHaveBeenCalled();
    });

    it('answers nothing when only the sender is named', async () => {
        expect(await manage({ assigneeUsers: [ME] }, [setting(ME, 'task_status', { browser: true })])).toEqual([]);
    });

    it('answers nothing for a receiver whose settings leave this kind of notice off', async () => {
        expect(await manage({}, [setting(BOB, 'task_status', {})])).toEqual([]);
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
    });

    it('answers nothing for a receiver whose settings do not list this key', async () => {
        expect(await manage({}, [setting(BOB, 'task_priority', { browser: true, email: true })])).toEqual([]);
    });

    it('makes one push and one email notice for a receiver who wants both, sharing a uniqueId', async () => {
        const out = await manage({}, [setting(BOB, 'task_status', { browser: true, email: true })]);
        expect(out.map((n) => n.notificationType).sort()).toEqual(['email', 'push']);
        expect(out[0].uniqueId).toBe(out[1].uniqueId);
        expect(out.every((n) => n.receiverID === BOB && n.isSchedule === false)).toBe(true);
    });

    it('sends a push when only mobile is on, and no email when email is off', async () => {
        const out = await manage({}, [setting(BOB, 'task_status', { mobile: true })]);
        expect(out.map((n) => n.notificationType)).toEqual(['push']);
    });

    it('never emails a chat message, even when email is on', async () => {
        const out = await manage({ key: 'message_create' }, [setting(BOB, 'message_create', { email: true, browser: true })]);
        expect(out.map((n) => n.notificationType)).toEqual(['push']);
    });

    it('marks who is directly involved and keeps the list off the saved row', async () => {
        const out = await manage({ assigneeUsers: [BOB, LEAD], directUsers: [BOB] }, [
            setting(BOB, 'task_status', { browser: true }),
            setting(LEAD, 'task_status', { browser: true }),
        ]);
        expect(out.find((n) => n.receiverID === BOB).reason).toBe('direct');
        expect(out.find((n) => n.receiverID === LEAD).reason).toBe('watching');
        expect(out.every((n) => !('directUsers' in n))).toBe(true);
    });

    it('leaves the reason out when the caller gave no direct users', async () => {
        const out = await manage({}, [setting(BOB, 'task_status', { browser: true })]);
        expect(out[0].reason).toBeUndefined();
    });

    it('fills in receiver and sender details, and web tokens for pushes only', async () => {
        const out = await manage({}, [setting(BOB, 'task_status', { browser: true, email: true })]);
        const push = out.find((n) => n.notificationType === 'push');
        const email = out.find((n) => n.notificationType === 'email');
        expect(push).toMatchObject({
            Employee_Email: `${BOB}@x.io`, Employee_Name: `Name ${BOB}`, Employee_profileImage: 'https://img/signed',
            User_Employee_Email: `${ME}@x.io`, User_Employee_Name: `Name ${ME}`, User_Employee_profileImage: 'https://img/signed',
            isSeen: false, notificationStatus: 'in-process', webTokens: [`tok-${BOB}`],
        });
        expect(email).toMatchObject({ webTokens: [], User_Employee_Verify: true, isSeen: false });
    });

    it('asks for the profile pictures in the notice\'s company', async () => {
        await manage({}, [setting(BOB, 'task_status', { browser: true })]);
        expect(mockWasabi).toHaveBeenCalledWith({ companyId: C, path: `${BOB}.png` });
        expect(mockWasabi).toHaveBeenCalledWith({ companyId: C, path: `${ME}.png` });
    });

    it('asks for each person\'s details once', async () => {
        await manage({ assigneeUsers: [BOB, LEAD] }, [setting(BOB, 'task_status', { browser: true }), setting(LEAD, 'task_status', { browser: true })]);
        expect(mockUsers.mock.calls[0][0].sort()).toEqual([BOB, LEAD, ME].sort());
    });

    it('leaves details blank for a person the user lookup does not know', async () => {
        mockUsers.mockResolvedValue([user(ME)]);
        const out = await manage({}, [setting(BOB, 'task_status', { browser: true })]);
        expect(out[0]).toMatchObject({ Employee_Email: '', Employee_Name: '', webTokens: [] });
    });

    it('saves every notice in the notice\'s own company and in the global feed', async () => {
        await manage({ assigneeUsers: [BOB, LEAD] }, [setting(BOB, 'task_status', { browser: true }), setting(LEAD, 'task_status', { browser: true })]);
        await flush();
        const own = MongoDbCrudOpration.mock.calls.filter((c) => c[1].type === SCHEMA_TYPE.NOTIFICATIONS && c[0] === C);
        expect(own).toHaveLength(2);
        own.forEach((c) => {
            expect(c[1].collection).toBe(dbCollections.NOTIFICATIONS);
            expect(c[2]).toBe('save');
        });
        expect(savedTo(C).map((n) => n.receiverID).sort()).toEqual([BOB, LEAD].sort());
        expect(savedTo('global')).toHaveLength(2);
    });

    it('still answers with the prepared notices when saving them fails', async () => {
        MongoDbCrudOpration.mockImplementation(async () => { throw new Error('write failed'); });
        const out = await manage({}, [setting(BOB, 'task_status', { browser: true })]);
        expect(out).toHaveLength(1);
        expect(out[0]).toMatchObject({ receiverID: BOB, notificationType: 'push' });
    });

    it('answers nothing, without throwing, when the settings are malformed', async () => {
        expect(await ctrl.manageNotificationSettings(validBody(), undefined)).toEqual([]);
    });

    it('rejects with the message when the user lookup fails', async () => {
        mockUsers.mockRejectedValue(new Error('users down'));
        await expect(manage({}, [setting(BOB, 'task_status', { browser: true })])).rejects.toEqual({ message: 'users down' });
    });
});

describe('createNotificationsData', () => {
    const notice = (over) => ({ ...validBody(), receiverID: BOB, uniqueId: 'u1', notificationType: 'push', ...over });

    it('answers an empty object for no notices and touches nothing', async () => {
        expect(await ctrl.createNotificationsData([])).toEqual({});
        expect(MongoDbCrudOpration).not.toHaveBeenCalled();
        expect(mockCount).not.toHaveBeenCalled();
    });

    it('bumps the unread counter once per uniqueId, for the receiver in the notice\'s company', async () => {
        await ctrl.createNotificationsData([notice(), notice({ notificationType: 'email' }), notice({ uniqueId: 'u2', receiverID: LEAD })]);
        expect(mockCount).toHaveBeenCalledTimes(2);
        expect(mockCount).toHaveBeenCalledWith({ body: { companyId: C, key: 5, userIds: [BOB], readAll: false } });
        expect(mockCount).toHaveBeenCalledWith({ body: { companyId: C, key: 5, userIds: [LEAD], readAll: false } });
    });

    it('does not bump the counter for an @mention, which is counted elsewhere', async () => {
        await ctrl.createNotificationsData([notice({ key: MENTION })]);
        expect(mockCount).not.toHaveBeenCalled();
        expect(savedTo(C)).toHaveLength(1);
    });

    it('saves every notice, and reports each save result', async () => {
        const out = await ctrl.createNotificationsData([notice(), notice({ uniqueId: 'u2' })]);
        expect(savedTo(C)).toHaveLength(2);
        expect(out.filter((r) => r.status === 'fulfilled' && r.value && r.value.id === 'n1')).toHaveLength(2);
    });

    it('keeps saving the other notices when one fails', async () => {
        let n = 0;
        MongoDbCrudOpration.mockImplementation(async (scope, obj, method) => {
            if (scope === C && method === 'save' && n++ === 0) throw new Error('first failed');
            return { id: 'x' };
        });
        const out = await ctrl.createNotificationsData([notice(), notice({ uniqueId: 'u2' })]);
        expect(out.filter((r) => r.status === 'rejected')).toHaveLength(1);
        expect(out.filter((r) => r.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    });

    it('rejects when given something that is not a list', async () => {
        await expect(ctrl.createNotificationsData(undefined)).rejects.toHaveProperty('message');
    });
});

describe('updateNotificationCount', () => {
    let errorSpy;
    beforeEach(() => { errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {}); });
    afterEach(() => errorSpy.mockRestore());

    it('swallows a failed counter update', async () => {
        mockCount.mockRejectedValue(new Error('count failed'));
        expect(() => ctrl.updateNotificationCount({ companyId: C, receiverID: BOB })).not.toThrow();
        await flush();
        expect(errorSpy).toHaveBeenCalledWith('ERR: ', expect.any(Error));
    });

    it('swallows a counter that throws at once', () => {
        mockCount.mockImplementation(() => { throw new Error('sync boom'); });
        expect(() => ctrl.updateNotificationCount({ companyId: C, receiverID: BOB })).not.toThrow();
        expect(errorSpy).toHaveBeenCalled();
    });
});

describe('createNotificationsBody', () => {
    const notice = (over) => ({ ...validBody(), receiverID: BOB, notificationType: 'push', createdAt: 'client-supplied', ...over });

    it('saves in the notice\'s company with the client createdAt removed', async () => {
        const input = notice();
        const saved = await ctrl.createNotificationsBody(input);
        expect(saved).toEqual({ id: 'n1' });
        const call = MongoDbCrudOpration.mock.calls.find((c) => c[0] === C);
        expect(call[1].type).toBe(SCHEMA_TYPE.NOTIFICATIONS);
        expect(call[1].collection).toBe(dbCollections.NOTIFICATIONS);
        expect(call[1].data).not.toHaveProperty('createdAt');
        expect(call[1].data).toMatchObject({ receiverID: BOB, companyId: C });
        expect(call[2]).toBe('save');
    });

    it('copies the saved notice into the global feed with its new id', async () => {
        await ctrl.createNotificationsBody(notice());
        await flush();
        expect(savedTo('global')[0]).toMatchObject({ notificationId: 'n1', receiverID: BOB, companyId: C });
    });

    it('wakes the receiver\'s inbox entry for a push about a task, in that company', async () => {
        await ctrl.createNotificationsBody(notice());
        expect(mockWake).toHaveBeenCalledWith(C, BOB, TASK);
    });

    it('does not wake the inbox for an email notice or a notice with no task', async () => {
        await ctrl.createNotificationsBody(notice({ notificationType: 'email' }));
        await ctrl.createNotificationsBody(notice({ taskId: undefined }));
        expect(mockWake).not.toHaveBeenCalled();
    });

    it('logs and carries on when waking the inbox fails', async () => {
        mockWake.mockRejectedValue(new Error('inbox down'));
        await expect(ctrl.createNotificationsBody(notice())).resolves.toEqual({ id: 'n1' });
        await flush();
        expect(logger.error).toHaveBeenCalledWith('Inbox wake on new activity failed: inbox down');
    });

    it('rejects with the message when the save fails and writes nothing global', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('write failed'));
        await expect(ctrl.createNotificationsBody(notice())).rejects.toEqual({ message: 'write failed' });
        expect(mockWake).not.toHaveBeenCalled();
    });
});

describe('createCommonNotificationsBody', () => {
    it('saves to the global scope and announces the insert on the socket', async () => {
        MongoDbCrudOpration.mockResolvedValue({ _id: 'g1' });
        const body = { ...validBody(), notificationId: 'n1' };
        const saved = await ctrl.createCommonNotificationsBody(body);
        expect(saved).toEqual({ _id: 'g1' });
        expect(MongoDbCrudOpration).toHaveBeenCalledWith('global', { type: dbCollections.NOTIFICATIONS, collection: dbCollections.NOTIFICATIONS, data: body }, 'save');
        expect(socketEmitter.emit).toHaveBeenCalledWith('insert', { type: 'insert', data: { _id: 'g1' }, updatedFields: {}, module: 'globalNotification' });
    });

    it('rejects with the message and stays quiet on the socket when the save fails', async () => {
        MongoDbCrudOpration.mockRejectedValue(new Error('global down'));
        await expect(ctrl.createCommonNotificationsBody(validBody())).rejects.toEqual({ message: 'global down' });
        expect(socketEmitter.emit).not.toHaveBeenCalled();
    });
});

describe('getWasabiImageUrl', () => {
    it('returns the signed address for the company and path', async () => {
        expect(await ctrl.getWasabiImageUrl(C, 'a.png')).toBe('https://img/signed');
        expect(mockWasabi).toHaveBeenCalledWith({ companyId: C, path: 'a.png' });
    });

    it('returns an empty string when the storage answers false', async () => {
        mockWasabi.mockResolvedValue({ status: false, statusText: 'nope' });
        expect(await ctrl.getWasabiImageUrl(C, 'a.png')).toBe('');
    });

    it('returns an empty string when the storage rejects', async () => {
        mockWasabi.mockRejectedValue(new Error('storage down'));
        expect(await ctrl.getWasabiImageUrl(C, 'a.png')).toBe('');
    });

    it('returns an empty string and logs when the storage call throws at once', async () => {
        mockWasabi.mockImplementation(() => { throw new Error('boom'); });
        expect(await ctrl.getWasabiImageUrl(C, 'a.png')).toBe('');
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error in get wasabi image url'));
    });
});
