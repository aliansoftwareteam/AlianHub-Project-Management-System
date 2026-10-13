const express = require('express');
const rawMulter = require('multer');
const actingAgent = require('../Modules/Agents/actingAgent');
const agentRequest = require('../Config/agentRequest');
const tokenNarrowing = require('../Config/tokenNarrowing');
const requestContext = require('../Config/requestContext');

const UID = 'u1';
const PROJECT = 'a'.repeat(24);

const asAgentToken = (req, res, next) => requestContext.run({ id: 'req-7' }, () =>
    tokenNarrowing.runNarrowed({ userId: UID, projectIds: [PROJECT] }, () =>
        agentRequest.runForAgentOf(UID, { chat: false }, () =>
            actingAgent.runAs({ userId: UID, agentId: 'ag1', agentName: 'Helper', depth: 0 }, next))));

const seen = () => ({
    mark: actingAgent.current() && actingAgent.current().agentId,
    agent: Boolean(agentRequest.agentOf(UID)),
    narrowing: tokenNarrowing.narrowingFor(UID),
    requestId: requestContext.requestId(),
});

const EXPECTED = { mark: 'ag1', agent: true, narrowing: [PROJECT], requestId: 'req-7' };

let server;
let base;
let filterSaw;

const start = (multerFactory) => new Promise((resolve) => {
    const app = express();
    app.use(express.json());
    const upload = multerFactory({
        storage: multerFactory.memoryStorage(),
        fileFilter: (req, file, cb) => { filterSaw = seen(); cb(null, true); },
    });
    app.post('/json', asAgentToken, (req, res) => res.json(seen()));
    app.post('/single', asAgentToken, upload.single('file'), (req, res) => res.json(seen()));
    app.post('/array', asAgentToken, upload.array('file'), (req, res) => res.json(seen()));
    app.post('/fields', asAgentToken, upload.fields([{ name: 'file' }]), (req, res) => res.json(seen()));
    app.post('/any', asAgentToken, upload.any(), (req, res) => res.json(seen()));
    app.post('/none', asAgentToken, upload.none(), (req, res) => res.json(seen()));
    app.post('/called', asAgentToken, (req, res) => upload.single('file')(req, res, () => res.json(seen())));
    server = app.listen(0, '127.0.0.1', () => {
        base = `http://127.0.0.1:${server.address().port}`;
        resolve();
    });
});

const stop = () => new Promise((resolve) => server.close(resolve));

const multipart = (withFile = true) => {
    const form = new FormData();
    form.append('path', 'a/b.txt');
    if (withFile) form.append('file', new Blob(['hello'], { type: 'text/plain' }), 'b.txt');
    return form;
};

const post = async (route, body) => (await fetch(`${base}${route}`, { method: 'POST', body })).json();

describe('an upload keeps the context of the request that sent it', () => {
    describe('through the shared multer helper', () => {
        const contextMulter = require('../utils/contextMulter');
        beforeAll(() => start(contextMulter));
        afterAll(stop);
        beforeEach(() => { filterSaw = null; });

        it('a JSON route sees the agent token context', async () => {
            expect(await post('/json', JSON.stringify({}))).toEqual(EXPECTED);
        });

        it.each(['/single', '/array', '/fields', '/any', '/called'])('%s sees the same context after the file is read', async (route) => {
            expect(await post(route, multipart())).toEqual(EXPECTED);
            expect(filterSaw).toEqual(EXPECTED);
        });

        it('a fields-only form sees the same context', async () => {
            expect(await post('/none', multipart(false))).toEqual(EXPECTED);
        });
    });

    describe('through multer itself', () => {
        beforeAll(() => start(rawMulter));
        afterAll(stop);

        it('loses the context, which is why every mount goes through the helper', async () => {
            expect(await post('/single', multipart())).not.toEqual(EXPECTED);
        });
    });
});
