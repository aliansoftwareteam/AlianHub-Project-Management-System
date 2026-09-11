jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));

const express = require('express');
const { setMiddlewareWithCV2, setMiddlewareV2 } = require('../Config/setMiddleware');

const COMPANY = '6f0000000000000000000c01';

const NEEDS_SESSION_AND_COMPANY = [
    ['post', '/api/v1/removeCache'],
    ['post', '/api/v1/mongoOpration'],
    ['put', '/api/v1/task'],
    ['post', '/api/v1/importTemplate'],
    ['post', '/api/v1/importSettingsNotification'],
    ['post', '/api/v1/export/pdf'],
    ['post', '/api/v1/export/csv'],
    ['post', '/api/v1/export/xlsx'],
    ['post', '/api/v1/recurring-tasks'],
    ['get', '/api/v1/recurring-tasks/project/p1'],
    ['post', '/api/v1/recurring-tasks/run-due'],
    ['post', '/api/v1/reminders'],
    ['get', '/api/v1/reminders'],
    ['post', '/api/v1/reminders/run-due'],
    ['post', '/api/v1/clips'],
    ['get', '/api/v1/clips'],
    ['post', '/api/v3/timeTracker/start'],
    ['post', '/api/v3/timetracker/capture'],
    ['post', '/api/v2/timesheet-approval/submit'],
    ['get', '/api/v2/timesheet-approval/queue'],
    ['post', '/api/v2/timesheet-approval/a1/review'],
    ['post', '/api/v1/manageTrackerUserPermission'],
    ['get', '/api/v1/projectSetting/autoArchive/p1'],
    ['post', '/api/v1/projectSetting/autoArchive'],
    ['post', '/api/v1/projectSetting/estimationScale'],
    ['post', '/api/v1/pushupdateunreadcommentscount'],
    ['post', '/api/v1/unsetCommentCounts'],
    ['post', '/api/v1/generatePrompt'],
    ['post', '/api/v1/generatePromptChat'],
    ['post', '/api/v1/deleteUserChat'],
    ['post', '/api/v1/getPrompts'],
    ['post', '/api/v1/findOnePrompts'],
    ['post', '/api/v1/getAiCategory'],
    ['post', '/api/v1/ai/description'],
    ['post', '/api/v1/getAiModels'],
    ['post', '/api/v1/findOneAiModel'],
    ['put', '/api/v1/push-mark-read'],
    ['get', '/api/v1/setting/skills'],
    ['put', '/api/v1/setting/skills'],
    ['get', '/api/v1/milestoneRange'],
    ['post', '/api/v1/checkSendInviatation'],
    ['put', '/api/v1/notifications'],
    ['get', '/api/v1/notifications/n1'],
];

const NEEDS_SESSION = [
    ['get', '/api/v1/freeCompanyCount/u1'],
    ['post', '/api/v1/getUserProfile'],
    ['post', '/api/v1/getTaskTypeImage'],
    ['patch', '/api/v2/auth/u1/change-password'],
    ['delete', '/api/v2/session/delete/u1'],
];

const STAYS_PUBLIC = [
    ['get', '/api/v1/generatePrompt/events/ev_abc'],
    ['post', '/api/v2/auth/login'],
    ['post', '/api/v2/auth/invitation-preview'],
    ['post', '/api/v2/checkPermission'],
    ['post', '/api/v2/createUser'],
];

let server;
let baseURL;

beforeAll(async () => {
    const app = express();
    app.use(express.json());
    setMiddlewareWithCV2(app);
    setMiddlewareV2(app);
    for (const [method, path] of [...NEEDS_SESSION_AND_COMPANY, ...NEEDS_SESSION, ...STAYS_PUBLIC]) {
        app[method](path, (req, res) => res.json({ reached: true }));
    }
    await new Promise((resolve) => { server = app.listen(0, '127.0.0.1', resolve); });
    baseURL = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

const send = (method, path, headers = {}) => fetch(`${baseURL}${path}`, {
    method: method.toUpperCase(),
    headers: { 'content-type': 'application/json', ...headers },
    body: method === 'get' ? undefined : '{}',
});

describe('routes that were reachable without a session', () => {
    it.each(NEEDS_SESSION_AND_COMPANY)('%s %s answers 401 with only a company id', async (method, path) => {
        const res = await send(method, path, { companyid: COMPANY });
        expect(res.status).toBe(401);
    });

    it.each(NEEDS_SESSION)('%s %s answers 401 without a token', async (method, path) => {
        const res = await send(method, path, { companyid: COMPANY });
        expect(res.status).toBe(401);
    });

    it.each([...NEEDS_SESSION_AND_COMPANY, ...NEEDS_SESSION])('%s %s answers 401 to a forged token', async (method, path) => {
        const res = await send(method, path, { companyid: COMPANY, authorization: 'Bearer forged' });
        expect(res.status).toBe(401);
    });
});

describe('routes that must stay public', () => {
    it.each(STAYS_PUBLIC)('%s %s is still reached without a session', async (method, path) => {
        const res = await send(method, path);
        expect(res.status).toBe(200);
    });
});

describe('route registration', () => {
    const record = () => {
        const routes = [];
        const app = {};
        for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
            app[method] = (path, ...handlers) => routes.push({ method, path, handlers });
        }
        return { app, routes };
    };
    const handlersOf = (routes, method, path) => (routes.find((r) => r.method === method && r.path === path) || {}).handlers;

    it('puts every instance-level write behind the instance guard', () => {
        const { requireInstanceAdmin } = require('../Modules/Instance/guard');
        const { app, routes } = record();
        require('../Modules/OAuth/routes').init(app);
        require('../Modules/emailTemplate/routes').init(app);
        require('../Modules/subscription/routes').init(app);
        require('../Modules/trackerDownload/routes').init(app);
        const expected = [
            ['get', '/api/v1/settings/oauth'],
            ['post', '/api/v1/settings/oauth'],
            ['post', '/api/v1/updateEmailTemplate'],
            ['post', '/api/v1/subscriptions'],
            ['delete', '/api/v1/tracker/delete/:id'],
            ['post', '/api/v1/tracker/create'],
            ['put', '/api/v1/tracker/update'],
        ];
        for (const [method, path] of expected) {
            expect(handlersOf(routes, method, path)[0]).toBe(requireInstanceAdmin);
        }
        expect(handlersOf(routes, 'get', '/api/v1/tracker')[0]).not.toBe(requireInstanceAdmin);
    });
});
