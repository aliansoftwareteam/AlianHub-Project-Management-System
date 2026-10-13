const { loginAs } = require('../../e2e/support/fixtures');

const OUTSIDER = 'someone@outside.e2e.test';

let member;

beforeAll(async () => {
    member = await loginAs('member');
});

describe('mail routes a signed-in member can call', () => {
    it('has no route that mails the address in the request', async () => {
        const res = await member.api.post('/api/v2/sendMail', { subject: 'Hello', html: '<p>Hello</p>', toMail: OUTSIDER, isHtml: true });
        expect(res.status).toBe(404);
    });

    it('has no route that mails the notification address in the request', async () => {
        const res = await member.api.post('/api/v2/single-notification-email', {
            notification: { Employee_Email: OUTSIDER, type: 'project', key: 'project_name', message: 'Hello', companyId: member.companyId },
            projects: [], tasks: [], comments: [],
        });
        expect(res.status).toBe(404);
    });

    it('sends support mail only to a mailbox the server names, and this server names none', async () => {
        const res = await member.api.post('/api/v2/support-mail', { message: 'Hello', toMail: OUTSIDER });
        expect(res.body.status).toBe(false);
    });

    it('asks for a session before support mail', async () => {
        const res = await fetch(new URL('/api/v2/support-mail', member.api.baseURL), {
            method: 'POST',
            headers: { 'content-type': 'application/json', companyid: member.companyId },
            body: JSON.stringify({ message: 'Hello' }),
        });
        expect(res.status).toBe(401);
    });
});
