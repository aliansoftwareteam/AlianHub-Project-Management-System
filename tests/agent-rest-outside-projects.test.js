/* The routes listed as changing nothing in a project, run with their handlers for a token created for an agent in
 * a workspace where agents are paused in every project: each is refused, or writes none of a project's own records. */
process.env.STORAGE_TYPE = 'server';
process.env.WORKFLOW_ENGINE = 'on';
jest.setTimeout(240000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
/* What reaches outside the process: mail, push, the file store, other services. */
jest.mock('axios', () => mockStub());
jest.mock('nodemailer', () => ({ createTransport: () => ({ sendMail: jest.fn(async () => ({})), verify: jest.fn(async () => true) }) }));
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../Modules/Workflows/queue', () => ({ dispatch: jest.fn(async () => true) }));

const fs = require('fs');
const path = require('path');
const net = require('net');
const express = require('express');
const { EventEmitter } = require('events');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/accessWorld');
const { OUTSIDE_EVERY_PROJECT } = require('./fixtures/agentRoutesOutsideProjects');
const { agentPerimeter } = require('../Modules/Agents/guard');
const projectLimits = require('../Modules/Agents/projectLimits');

const { CID, OWNER, P_OPEN, L_OPEN, T_OPEN, settle } = world;
const { seed, rows } = world.create(mockDb);

jest.spyOn(net.Socket.prototype, 'connect').mockImplementation(function refused() {
    process.nextTick(() => this.destroy(new Error('this test reaches nothing outside its process')));
    return this;
});
global.fetch = jest.fn(async () => { throw new Error('this test reaches nothing outside its process'); });

const routes = {};
const mounted = [];
const served = express();
const register = (method) => (routePath, ...handlers) => {
    routes[`${method} ${routePath}`] = handlers.flat();
    served[method.toLowerCase()](routePath, ...handlers);
};
const mount = (prefix, ...handlers) => { if (typeof prefix === 'string') mounted.push([prefix, handlers.flat()]); };
const app = { get: register('GET'), post: register('POST'), put: register('PUT'), patch: register('PATCH'), delete: register('DELETE'), use: mount };

const routeFilesUnder = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : routeFilesUnder(path.join(dir, entry.name));
    return entry.name === 'routes.js' ? [path.join(dir, entry.name)] : [];
});
routeFilesUnder(path.join(__dirname, '..', 'Modules')).sort().forEach((file) => require(file).init(app));

const ANY_ID = '6f0000000000000000000f03';
const agentToken = (uid) => ({ uid, apiToken: { _id: '6f0000000000000000000101', kind: 'agent', name: 'Claude', userId: uid, scopes: ['read', 'write'] } });

const mountedOver = (url) => mounted.filter(([prefix]) => url === prefix || url.startsWith(`${prefix}/`)).flatMap(([prefix, handlers]) => handlers.map((handler) => (req, res, next) => {
    Object.assign(req, { url: url.slice(prefix.length) || '/', path: url.slice(prefix.length) || '/' });
    return handler(req, res, () => { Object.assign(req, { url, path: url }); return next(); });
}));

const namedIn = (route) => [...route.matchAll(/:([A-Za-z_]+)/g)].map((match) => match[1]);
const paramsOf = (route) => Object.fromEntries(namedIn(route).map((name) => [name, { projectId: P_OPEN, pid: P_OPEN, taskId: T_OPEN, tid: T_OPEN, sprintId: L_OPEN, companyId: CID }[name] || ANY_ID]));
const pathOf = (route, params) => Object.entries(params).reduce((text, [name, value]) => text.replace(`:${name}`, value), route);

const NO_ANSWER = 'gave no answer';
const ANSWERS = ['send', 'json', 'end', 'redirect', 'sendFile', 'download', 'render', 'sendStatus'];

/* The whole of a request as the server runs it: what stands in front of every route, the route's guards, its handler. */
const run = (route, caller, body, { handled = true, params: given } = {}) => new Promise((resolve) => {
    const params = { ...paramsOf(route), ...given };
    const [method, url] = pathOf(route, params).split(' ');
    const res = new EventEmitter();
    const done = (answer) => { res.headersSent = true; res.emit('finish'); resolve({ code: res.statusCode, body: answer }); return res; };
    Object.assign(res, { statusCode: 200, headersSent: false, locals: {} });
    res.status = (code) => { res.statusCode = code; return res; };
    ANSWERS.forEach((name) => { res[name] = done; });
    ['setHeader', 'set', 'header', 'type', 'cookie', 'clearCookie', 'attachment', 'append', 'writeHead', 'write', 'flushHeaders', 'removeHeader', 'contentType', 'vary'].forEach((name) => { res[name] = () => res; });
    res.getHeader = () => undefined;
    res.get = () => undefined;
    const req = Object.assign(new EventEmitter(), {
        ...caller, app: served, method, originalUrl: url, url, path: url, baseUrl: '', route: { path: route.split(' ')[1] }, protocol: 'http', hostname: 'localhost',
        query: {}, params, headers: { companyid: CID, 'content-type': 'application/json', host: 'localhost' }, aud: CID, ip: '1.1.1.1', body: JSON.parse(JSON.stringify(body)), cookies: {},
    });
    req.get = (name) => req.headers[String(name).toLowerCase()];
    req.header = req.get;
    const chain = [agentPerimeter, ...mountedOver(url), ...(handled ? routes[route] : routes[route].slice(0, -1))];
    const step = (at) => {
        if (at === chain.length) return resolve(handled ? { code: res.statusCode, body: NO_ANSWER } : 'reached its handler');
        return Promise.resolve().then(() => chain[at](req, res, (error) => (error ? done({ statusText: String(error.message || error) }) : step(at + 1))))
            .catch((error) => resolve({ code: 500, body: { statusText: String(error && error.message) } }));
    };
    setTimeout(() => resolve({ code: res.statusCode, body: NO_ANSWER }), 1500).unref();
    step(0);
}).then(async (result) => { await settle(); return result; });

/* The records that are a project's own: an agent changes none of them where agents are paused. */
const OF_A_PROJECT = new Set([
    SCHEMA_TYPE.TASKS, SCHEMA_TYPE.PROJECTS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.FOLDERS, SCHEMA_TYPE.COMMENTS, SCHEMA_TYPE.TIMESHEET, SCHEMA_TYPE.PAGES,
    SCHEMA_TYPE.PAGE_COMMENTS, SCHEMA_TYPE.CUSTOM_FIELDS, SCHEMA_TYPE.EPICS, SCHEMA_TYPE.WHITEBOARDS, SCHEMA_TYPE.MAIN_CHATS, SCHEMA_TYPE.HISTORY,
]);
const READS = new Set(['find', 'findOne', 'aggregate', 'count', 'countDocuments', 'estimatedDocumentCount', 'distinct', 'findById', 'exists']);
const writesSince = (from) => mockDb.calls.slice(from).filter((call) => OF_A_PROJECT.has(call.type) && !READS.has(call.method)).map((call) => `${call.method} ${call.type}`);

/* Everything a request could name of the open project, under every name the routes read it by. */
const named = {
    companyId: CID, CompanyId: CID, userId: OWNER, uid: OWNER, id: T_OPEN, _id: T_OPEN,
    projectId: P_OPEN, ProjectID: P_OPEN, ProjectId: P_OPEN, pid: P_OPEN, projectIds: [P_OPEN], projects: [P_OPEN],
    taskId: T_OPEN, TaskId: T_OPEN, ticketId: T_OPEN, TicketID: T_OPEN, tid: T_OPEN, taskIds: [T_OPEN], tasks: [T_OPEN], ids: [T_OPEN],
    sprintId: L_OPEN, sprintIds: [L_OPEN], listId: L_OPEN, folderId: ANY_ID,
    name: 'Probe', title: 'Probe', text: 'Probe', message: 'Probe', description: 'Probe', key: 'probe', type: 'tasks', value: 1, minutes: 5,
    date: '2026-10-05', dueAt: '2026-10-05T10:00:00.000Z', remindAt: '2026-10-05T10:00:00.000Z',
};
const everything = { ...named, data: { ...named }, updateObject: { ...named, TaskName: 'Probe', ProjectName: 'Probe' }, projectData: { _id: P_OPEN, id: P_OPEN, CompanyId: CID }, userData: { id: OWNER, _id: OWNER } };

const pauseEveryProject = () => rows(SCHEMA_TYPE.PROJECTS).forEach((project) => { project.agentLimits = { paused: true }; });
const world2 = () => { seed(); pauseEveryProject(); };

const EPIC = '6f0000000000000000000e21';
const AGENT = '6f0000000000000000000e24';
const REMINDER = '6f0000000000000000000e25';
const FORMULA = '6f0000000000000000000e26';
const seedEpic = () => mockDb.seed(SCHEMA_TYPE.EPICS, { _id: EPIC, name: 'Launch', ProjectID: P_OPEN, deletedStatusKey: 0, taskCount: 0 });
const seedAgent = () => mockDb.seed(SCHEMA_TYPE.AGENTS, { _id: AGENT, name: 'Triage', account: 'workspace', projectIds: [], skills: [], deletedStatusKey: 0 });
const seedReminder = () => mockDb.seed(SCHEMA_TYPE.REMINDERS, { _id: REMINDER, userId: OWNER, taskId: T_OPEN, projectId: P_OPEN, title: 'Look again', reminderAt: new Date(Date.now() - 60000), fired: false, deletedStatusKey: 0 });
const seedFormula = () => mockDb.seed(SCHEMA_TYPE.CUSTOM_FIELDS, { _id: FORMULA, fieldTitle: 'Twice', fieldType: 'formula', formulaExpression: '1 + 1', projectId: [P_OPEN], global: true, isDelete: false });
const TASK_WRITE = [{ _id: T_OPEN }, { $set: { TaskName: 'Changed' } }];
const INTO_TASKS = [[{ $match: {} }, { $merge: { into: 'tasks' } }]];

/* A request built the way each of these routes takes one, naming work of the open project: [params, body, what is there first]. */
const AS_THE_ROUTE_TAKES_IT = {
    'POST /api/v2/sprints/backlog': [[{}, { projectId: P_OPEN }]],
    'POST /api/v1/mongoOpration': [
        [{}, { dbName: CID, collection: 'tasks', methodName: 'updateOne', dataObj: TASK_WRITE }],
        [{}, { dbName: CID, collection: 'tasks', methodName: 'findOneAndUpdate', dataObj: TASK_WRITE }],
        [{}, { dbName: CID, collection: 'tasks', methodName: 'aggregate', dataObj: INTO_TASKS }],
        [{}, { dbName: CID, collection: 'projects', methodName: 'updateMany', dataObj: [{}, { $set: { ProjectName: 'Changed' } }] }],
    ],
    'POST /api/v1/estimatedTime': [[{}, { queryeta: INTO_TASKS[0] }], [{}, { queryeta: INTO_TASKS }]],
    'POST /api/v1/timesheet': [[{}, { queryeta: INTO_TASKS[0] }], [{}, { queryeta: INTO_TASKS }]],
    'POST /api/v1/task/find': [[{}, { query: TASK_WRITE, method: 'updateOne' }], [{}, { query: INTO_TASKS, method: 'aggregate' }]],
    'POST /api/v1/tabSyncTask': [[{}, { pid: P_OPEN, sprintId: L_OPEN, istableTask: false }]],
    'POST /api/v1/reminders': [[{}, { taskId: T_OPEN, projectId: P_OPEN, title: 'Look again', reminderAt: '2030-01-01T10:00:00.000Z' }]],
    'PATCH /api/v1/reminders/:id': [[{ id: REMINDER }, { title: 'Later', reminderAt: '2030-01-02T10:00:00.000Z' }, seedReminder]],
    'POST /api/v1/reminders/:id/run-now': [[{ id: REMINDER }, {}, seedReminder]],
    'POST /api/v1/reminders/run-due': [[{}, { companyId: CID, userId: OWNER }, seedReminder]],
    'POST /api/v1/reports/custom': [[{}, { name: 'By status', dimension: 'status', measure: 'count', filters: { projectIds: [P_OPEN] } }]],
    'POST /api/v1/reports/custom/run': [[{}, { dimension: 'status', measure: 'count', filters: { projectIds: [P_OPEN] } }]],
    'POST /api/v1/reports/custom/from-template': [[{}, { templateId: 'tasks-by-status', key: 'tasks-by-status' }]],
    'PUT /api/v2/users/favourites': [[{}, { type: 'project', id: P_OPEN, favourite: true }], [{}, { type: 'task', id: T_OPEN, favourite: true }], [{}, { type: 'list', id: L_OPEN, favourite: true }]],
    'POST /api/v2/recent-visits': [[{}, { type: 'task', id: T_OPEN }], [{}, { type: 'project', id: P_OPEN }]],
    'POST /api/v1/notes': [[{}, { title: 'Note', content: 'Text', taskId: T_OPEN, projectId: P_OPEN }]],
    'POST /api/v1/clips': [[{}, { url: 'https://example.com/clip.webm', title: 'Clip', taskId: T_OPEN, projectId: P_OPEN }]],
    'PUT /api/v1/notifications': [[{}, { id: P_OPEN, key: 'project', fieldToUpdate: 'email', valueToUpdate: true, elementKey: 'comments', userId: OWNER }]],
    'POST /api/v1/updateunreadcommentscount': [[{}, { key: 'comments', projectId: P_OPEN, sprintId: L_OPEN, taskId: T_OPEN, userIds: [OWNER], readAll: false }]],
    'PUT /api/v1/collection/userid': [[{}, { key: 'comments', projectId: P_OPEN, taskId: T_OPEN }]],
    'PUT /api/v1/timesheet/workload-capacity': [[{}, { points: 5 }]],
    'POST /api/v2/agents/proposals': [[{}, { agentId: AGENT, taskId: T_OPEN, title: 'Rename', changes: [{ action: 'task.update', params: { taskId: T_OPEN, fields: { TaskName: 'Changed' } } }] }, seedAgent]],
    'POST /api/v2/agents/runs': [[{}, { agentId: AGENT, taskId: T_OPEN, skill: 'triage' }, seedAgent]],
    'POST /api/v2/automations/backtest': [[{}, { trigger: { type: 'event', event: 'task.created' }, scope: { allProjects: false, projectIds: [P_OPEN] }, steps: [{ id: 's1', type: 'action', action: 'add_comment', config: { body: 'hi' } }] }]],
    'POST /api/v1/automations/preview': [[{}, { conditions: { projectId: P_OPEN }, actions: [{ type: 'set_priority', value: 'HIGH' }] }]],
    'POST /api/v1/ai/quality/held-out': [[{}, { projectId: P_OPEN, taskIds: [T_OPEN] }]],
};

/* The four this run found writing a project's records, which now ask the project's rule: [params, body, what is there first, what is written]. */
const ASKS_THE_PROJECT = {
    'PUT /api/v1/project/sprint/:id': [{ id: L_OPEN }, { key: '$addToSet', updateObject: { favouriteTasks: { userId: OWNER } } }, null, 'findOneAndUpdate sprints'],
    'POST /api/v2/epics/:id/recount': [{ id: EPIC }, {}, seedEpic, 'findOneAndUpdate epics'],
    'POST /api/v2/custom-fields/compute': [{}, { taskIds: [T_OPEN] }, seedFormula, 'findOneAndUpdate tasks'],
    'POST /api/v1/updateTaskIndexOnload': [{}, { companyId: CID, taskUpdate: { data: T_OPEN, item: { indexName: 'groupByStatusIndex', searchKey: 'statusKey', searchValue: 1 } } }, null, 'findOneAndUpdate tasks'],
};

const INSTANCE = 'is answered by the instance owner\'s guard or key, which takes no token';
const KEYED_IN_ITS_HANDLER = ['POST /api/v1/setPresetCompany'];
const handledRoutes = Object.entries(OUTSIDE_EVERY_PROJECT).filter(([reason]) => reason !== INSTANCE).flatMap(([, list]) => list);
const requestsOf = (route) => [[undefined, everything], [undefined, {}], ...(AS_THE_ROUTE_TAKES_IT[route] || [])];

beforeAll(() => { ['error', 'log'].forEach((level) => jest.spyOn(console, level).mockImplementation(() => {})); });

describe('a route that writes a record of a project and so asks the project\'s rule', () => {
    const sent = async (route, caller, paused) => {
        const [params, body, before] = ASKS_THE_PROJECT[route];
        seed();
        if (paused) pauseEveryProject();
        if (before) before();
        const from = mockDb.calls.length;
        const answer = await run(route, caller, body, { params });
        return { code: answer.code, statusText: answer.body && answer.body.statusText, writes: writesSince(from) };
    };

    it.each(Object.keys(ASKS_THE_PROJECT))('%s writes it for an agent, and is refused where agents are paused', async (route) => {
        const written = ASKS_THE_PROJECT[route][3];

        expect((await sent(route, agentToken(OWNER), false)).writes).toContain(written);
        expect(await sent(route, agentToken(OWNER), true)).toEqual({ code: 403, statusText: projectLimits.REASON.PAUSED, writes: [] });
        expect((await sent(route, { uid: OWNER }, true)).writes).toContain(written);
    });
});

describe('a route listed as changing nothing in a project, for an agent where agents are paused in every project', () => {
    it('writes none of a project\'s own records, or is refused', async () => {
        const wrote = [];
        const seen = [];
        for (const route of handledRoutes) {
            for (const [params, body, before] of requestsOf(route)) {
                world2();
                if (before) before();
                const from = mockDb.calls.length;
                // eslint-disable-next-line no-await-in-loop
                const answer = await run(route, agentToken(OWNER), body, { params });
                const writes = [...new Set(writesSince(from))];
                seen.push(`${route}\t${answer.code}\t${String(JSON.stringify(answer.body)).slice(0, 160)}\t${writes.join(',')}\t${mockDb.calls.length - from}\t${params ? 'as the route takes it' : ''}`);
                if (writes.length) wrote.push(`${route}: ${writes.join(', ')}`);
            }
        }
        if (process.env.OUTSIDE_OUT) fs.writeFileSync(process.env.OUTSIDE_OUT, seen.join('\n'));

        expect(handledRoutes.length).toBeGreaterThan(150);
        expect(Object.keys(AS_THE_ROUTE_TAKES_IT).filter((route) => !handledRoutes.includes(route))).toEqual([]);
        expect([...new Set(wrote)]).toEqual([]);
    });

    it('is stopped by its own guard or its key, where it is the instance owner\'s', async () => {
        const passed = [];
        for (const route of OUTSIDE_EVERY_PROJECT[INSTANCE]) {
            world2();
            const from = mockDb.calls.length;
            // eslint-disable-next-line no-await-in-loop
            const answer = await run(route, agentToken(OWNER), everything, { handled: KEYED_IN_ITS_HANDLER.includes(route) });
            if (answer === 'reached its handler' || answer.code < 400 || writesSince(from).length) passed.push(route);
        }

        expect(passed).toEqual([]);
    });
});
