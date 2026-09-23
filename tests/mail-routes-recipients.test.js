jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../Modules/service.js', () => ({
    SendEmail: jest.fn((subject, body, to, isHtml, cb) => cb({ status: true })),
    SendNotificationEmail: jest.fn((subject, body, to, isHtml, cb) => cb({ status: true })),
}));

const fs = require('fs');
const path = require('path');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { SendEmail, SendNotificationEmail } = require('../Modules/service.js');

const SENDER_ID = '6f0000000000000000000a01';
const SENDER = { _id: SENDER_ID, Employee_Name: 'Max Member', Employee_Email: 'max.member@example.test' };
const SUPPORT_MAILBOX = 'support@example.test';
const OUTSIDER = 'someone@outside.test';

const record = () => {
    const routes = [];
    const app = {};
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'use']) {
        app[method] = (routePath, ...handlers) => routes.push({ method, path: routePath, handlers });
    }
    return { app, routes };
};

const mailRoutes = () => {
    const { app, routes } = record();
    require('../Modules/EmailNotification/routes').init(app);
    require('../Modules/notification/sendEmail/routes').init(app);
    return routes;
};

const callSupportMail = (body) => new Promise((resolve) => {
    const res = { statusCode: 200 };
    res.status = jest.fn((code) => { res.statusCode = code; return res; });
    res.send = jest.fn((payload) => resolve({ status: res.statusCode, body: payload }));
    res.json = res.send;
    require('../Modules/EmailNotification/supportMail').sendSupportMail({ uid: SENDER_ID, body }, res);
});

const allSentTo = () => [...SendEmail.mock.calls, ...SendNotificationEmail.mock.calls].map((call) => String(call[2]));

beforeEach(() => {
    SendEmail.mockClear();
    SendNotificationEmail.mockClear();
    MongoDbCrudOpration.mockReset();
    MongoDbCrudOpration.mockImplementation(async (db, obj, method) => (method === 'findOne' ? SENDER : null));
    delete process.env.SUPPORT_MAIL;
});

describe('mail routes', () => {
    it('registers no route that mails whatever address the request names', () => {
        const paths = mailRoutes().map((route) => route.path);
        expect(paths).not.toContain('/api/v2/sendMail');
        expect(paths).not.toContain('/api/v2/single-notification-email');
    });

    it('puts the support mail route behind a session, a company and a rate limit', () => {
        const route = mailRoutes().find((r) => r.method === 'post' && r.path === '/api/v2/support-mail');
        expect(route).toBeDefined();
        expect(route.handlers.length).toBe(2);
        const guards = fs.readFileSync(path.join(__dirname, '..', 'Config', 'setMiddleware.js'), 'utf8');
        expect(guards).toContain('"/api/v2/support-mail"');
    });
});

describe('support mail', () => {
    it('goes only to the mailbox the server names, whatever the request asks for', async () => {
        process.env.SUPPORT_MAIL = SUPPORT_MAILBOX;
        const answer = await callSupportMail({ message: 'The export is stuck', toMail: OUTSIDER, subject: 'Pay this invoice', html: '<a href="https://evil.test">x</a>', isHtml: true });
        expect(answer.body.status).toBe(true);
        expect(allSentTo()).toEqual([SUPPORT_MAILBOX]);
        const [subject, text, , isHtml] = SendEmail.mock.calls[0];
        expect(isHtml).toBe(false);
        expect(subject).not.toContain('Pay this invoice');
        expect(subject).toContain(SENDER.Employee_Name);
        expect(text).toContain(SENDER.Employee_Email);
        expect(text).toContain('The export is stuck');
        expect(text).not.toContain('evil.test');
    });

    it('sends nothing when the server names no support mailbox', async () => {
        const answer = await callSupportMail({ message: 'Hello', toMail: OUTSIDER });
        expect(answer.body.status).toBe(false);
        expect(allSentTo()).toEqual([]);
    });

    it.each([[{}], [{ message: '   ' }], [{ message: { $ne: null } }]])('refuses %j without sending', async (body) => {
        process.env.SUPPORT_MAIL = SUPPORT_MAILBOX;
        const answer = await callSupportMail(body);
        expect(answer.body.status).toBe(false);
        expect(allSentTo()).toEqual([]);
    });

    it('keeps a line break in the sender name out of the subject', async () => {
        process.env.SUPPORT_MAIL = SUPPORT_MAILBOX;
        MongoDbCrudOpration.mockImplementation(async () => ({ ...SENDER, Employee_Name: 'Max\r\nBcc: someone@outside.test' }));
        await callSupportMail({ message: 'Hello' });
        expect(SendEmail.mock.calls[0][0]).not.toMatch(/[\r\n]/);
    });
});
