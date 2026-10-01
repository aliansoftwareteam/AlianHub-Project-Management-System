/* The web app's Goals store and page are tested against frontend/tests/fixtures/goalResponses.json.
   This test is where that file comes from: the page's own request builder makes the requests, the
   real handlers answer them over fakeMongo, and the file must equal what was asked and answered.
   So a request the server would refuse, or a change to the response shape, fails here until the
   fixture is written again with UPDATE_GOALS_FIXTURE=1. */
const fs = require('fs');
const path = require('path');

const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (...args) => mockDb.crud(...args),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/settings/securityPermissions/controller', () => ({ fetchRules: jest.fn(async () => []) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Audit/recorder', () => ({ recordAuditFromReq: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const goals = require('../Modules/Goals/controller');
const counts = require('../Modules/Goals/goalCounts');
const { withProgress } = require('../Modules/Goals/helpers/goalProgress');
const request = require('../frontend/src/views/Goals/goalRequest');

const FIXTURE = path.join(__dirname, '..', 'frontend', 'tests', 'fixtures', 'goalResponses.json');
const C = '6f0000000000000000000c01';
const ME = '6f0000000000000000000001';
const SAM = '6f0000000000000000000002';
const ADA = '6f0000000000000000000003';
const GIL = '6f0000000000000000000004';
const GONE = '6f0000000000000000000005';
const PEOPLE = { me: ME, sam: SAM, ada: ADA, gil: GIL };
const ROLES = { [ME]: 3, [SAM]: 3, [ADA]: 2, [GIL]: 0 };

const REVENUE = '6f0000000000000000000e01';
const CHURN = '6f0000000000000000000e02';
const HIRING = '6f0000000000000000000e03';
const BRAND = '6f0000000000000000000e04';
const LAUNCH = '6f0000000000000000000e05';
const SECRET = '6f0000000000000000000e06';
const ROLLOUT = '6f0000000000000000000e07';
const target = (n) => `6f0000000000000000000f${String(n).padStart(2, '0')}`;

const WEBSITE = '6f0000000000000000000a01';
const HIRING_PLAN = '6f0000000000000000000a02';
const SPRINT = '6f0000000000000000000b01';
const BACKLOG = '6f0000000000000000000b02';
const TEAM_LIST = '6f0000000000000000000b03';
const NO_LIST = '6f0000000000000000000b09';
const task = (n) => `6f0000000000000000000d${String(n).padStart(2, '0')}`;
const LOOSE_TASK = task(5);

const SEEDED_AT = new Date('2026-09-20T09:00:00.000Z');
const NOW = new Date('2026-10-01T06:30:00.000Z');
const TIMERS_LEFT_REAL = ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'];

const seedGoal = (_id, name, ownerUserId, over = {}, targets = []) => mockDb.seed(SCHEMA_TYPE.GOALS, {
    _id, name, description: '', ownerUserId, periodStart: '', periodEnd: '', visibility: 'workspace', sharedWith: [], color: '',
    revision: 0, createdBy: ownerUserId, updatedBy: ownerUserId, deletedStatusKey: 0, createdAt: SEEDED_AT,
    ...over,
    ...withProgress(targets.map((entry) => ({ weight: 1, updatedBy: ownerUserId, updatedAt: SEEDED_AT, ...entry })), SEEDED_AT),
});

const seedList = (_id, projectId, name) => mockDb.seed(SCHEMA_TYPE.SPRINTS, { _id, projectId, name, private: false, AssigneeUserId: [], deletedStatusKey: 0 });
const seedTask = (n, ProjectID, sprintId, TaskName, statusType = 'default_active') => mockDb.seed(SCHEMA_TYPE.TASKS, {
    _id: task(n), TaskName, ProjectID, sprintId, deletedStatusKey: 0, isParentTask: true, statusType,
});

/* An open project with two lists, and a private one that only two of the people are on. Seeded after
   the goals' own steps, so the ids the stand-in database hands out in those steps stay as recorded. */
const seedWork = () => {
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: WEBSITE, ProjectName: 'Website', isPrivateSpace: false, AssigneeUserId: [], deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.PROJECTS, { _id: HIRING_PLAN, ProjectName: 'Hiring plan', isPrivateSpace: true, AssigneeUserId: [ME, SAM], deletedStatusKey: 0 });
    seedList(SPRINT, WEBSITE, 'Sprint 1');
    seedList(BACKLOG, WEBSITE, 'Backlog');
    seedList(TEAM_LIST, HIRING_PLAN, 'Interviews');
    seedTask(1, WEBSITE, SPRINT, 'Design the home page', 'close');
    seedTask(2, WEBSITE, SPRINT, 'Build the home page');
    seedTask(3, WEBSITE, SPRINT, 'Write the copy');
    seedTask(4, WEBSITE, BACKLOG, 'Pick a font', 'close');
    seedTask(5, WEBSITE, BACKLOG, 'Fix the footer');
    seedTask(6, HIRING_PLAN, TEAM_LIST, 'Phone screens', 'close');
    seedTask(7, HIRING_PLAN, TEAM_LIST, 'On-site days');
};

const seed = () => {
    Object.entries(ROLES).forEach(([userId, roleType]) => mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId, roleType, status: 2, isDelete: false }));
    mockDb.seed(SCHEMA_TYPE.COMPANY_USERS, { userId: GONE, roleType: 3, status: 2, isDelete: true });
    ['USD', 'EUR'].forEach((code) => mockDb.seed(SCHEMA_TYPE.CURRENCY_LIST, { code }));

    seedGoal(REVENUE, 'Grow revenue', ME, { description: 'Net new revenue only', periodStart: '2026-10-01', periodEnd: '2026-12-31', color: '#2F3990' }, [
        { id: target(1), name: 'New customers', kind: 'number', start: 0, target: 10, current: 3, unit: 'customers' },
        { id: target(2), name: 'Revenue', kind: 'currency', start: 1000, target: 5000, current: 1000, unit: '', currencyCode: 'USD', weight: 2 },
        { id: target(3), name: 'Pricing page live', kind: 'boolean', done: true },
    ]);
    seedGoal(CHURN, 'Cut churn', ME, { periodStart: '2027-01-01', periodEnd: '2027-03-31', visibility: 'private' }, [
        { id: target(4), name: 'Monthly churn', kind: 'number', start: 40, target: 10, current: 25, unit: '%' },
    ]);
    seedGoal(HIRING, 'Hire the team', SAM, { periodStart: '2026-07-01', periodEnd: '2026-09-30', visibility: 'people', sharedWith: [ME] }, [
        { id: target(5), name: 'Offer accepted', kind: 'boolean', done: false },
        { id: target(6), name: 'Engineers', kind: 'number', start: 0, target: 4, current: 4, unit: '' },
    ]);
    seedGoal(BRAND, 'Refresh the brand', SAM);
    seedGoal(LAUNCH, 'Launch v1', ME, { periodStart: '2026-01-01', periodEnd: '2026-03-31', deletedStatusKey: 2 }, [
        { id: target(7), name: 'Shipped', kind: 'boolean', done: true },
    ]);
    seedGoal(SECRET, 'A plan of Sam\'s own', SAM, { visibility: 'private' });
    seedGoal(ROLLOUT, 'Client rollout', SAM, { visibility: 'people', sharedWith: [GIL] }, [
        { id: target(8), name: 'Sites live', kind: 'number', start: 0, target: 5, current: 2, unit: 'sites' },
    ]);
};

const HANDLERS = [
    ['get', /^\/api\/v2\/goals(\?.*)?$/, goals.listGoals],
    ['post', /^\/api\/v2\/goals$/, goals.createGoal],
    ['get', /^\/api\/v2\/goals\/([^/]+)$/, goals.getGoal],
    ['patch', /^\/api\/v2\/goals\/([^/]+)$/, goals.updateGoal],
    ['post', /^\/api\/v2\/goals\/([^/]+)\/archive$/, goals.archiveGoal],
    ['post', /^\/api\/v2\/goals\/([^/]+)\/restore$/, goals.restoreGoal],
    ['post', /^\/api\/v2\/goals\/([^/]+)\/targets$/, goals.addTarget],
    ['patch', /^\/api\/v2\/goals\/([^/]+)\/targets\/([^/]+)$/, goals.editTarget],
    ['delete', /^\/api\/v2\/goals\/([^/]+)\/targets\/([^/]+)$/, goals.removeTarget],
    ['put', /^\/api\/v2\/goals\/([^/]+)\/targets\/([^/]+)\/value$/, goals.setTargetValue],
];

/* Express would do this: the path picks the handler and fills its parameters, the query string becomes req.query. */
const ask = async ({ method, path: asked, body }, as = 'me') => {
    const [, pattern, handler] = HANDLERS.find(([verb, route]) => verb === method && route.test(asked)) || [];
    if (!handler) throw new Error(`the page asked for a route the server does not have: ${method} ${asked}`);
    const [, id, targetId] = pattern.exec(asked.split('?')[0]);
    const query = Object.fromEntries(new URLSearchParams(asked.split('?')[1] || ''));
    const res = { statusCode: 200, body: undefined };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (payload) => { res.body = payload; return res; };
    await handler({ method: method.toUpperCase(), headers: { companyid: C }, aud: C, uid: PEOPLE[as], body: body === undefined ? {} : body, query, params: { id, targetId } }, res);
    return JSON.parse(JSON.stringify({ as, request: { method, path: asked, ...(body === undefined ? {} : { body }) }, statusCode: res.statusCode, response: res.body }));
};

const record = async () => {
    const out = {};
    let minute = 0;
    const step = async (name, asked, as) => {
        jest.setSystemTime(new Date(NOW.getTime() + minute * 60000));
        minute += 1;
        out[name] = await ask(asked, as);
        /* A count that a read starts runs behind its answer: it is over before the next request is made. */
        await counts.idle();
        return out[name].response.data;
    };

    await step('list', request.listRequest());
    await step('listMine', request.listRequest({ mine: true }));
    await step('listArchived', request.listRequest({ archived: true }));
    await step('listGuest', request.listRequest(), 'gil');
    await step('listAdmin', request.listRequest(), 'ada');
    const revenue = await step('read', request.readRequest(REVENUE));
    await step('readShared', request.readRequest(HIRING));
    await step('readMissing', request.readRequest(SECRET));

    const created = await step('created', request.createRequest({ name: '  Ship the mobile app ', periodStart: '2026-10-01', periodEnd: '2026-12-31' }));
    await step('createRefused', request.createRequest({ name: 'Backwards', periodStart: '2026-12-31', periodEnd: '2026-10-01' }));
    await step('createRefusedGuest', request.createRequest({ name: 'A guest\'s goal' }), 'gil');

    await step('described', request.updateRequest(REVENUE, { description: 'Net new revenue, all regions' }));
    const churn = await step('shared', request.updateRequest(CHURN, { visibility: 'people', sharedWith: [SAM, GIL] }));
    await step('sharedRefused', request.updateRequest(CHURN, { sharedWith: [GONE] }));
    await step('editRefused', request.updateRequest(HIRING, { name: 'Taken' }));

    await step('valueSet', request.valueRequest(REVENUE, revenue.targets[0], '5'));
    await step('valueUnticked', request.valueRequest(REVENUE, revenue.targets[2], false));
    await step('valueRefused', request.valueRequest(HIRING, out.readShared.response.data.targets[0], true));
    await step('valueTooLarge', request.valueRequest(REVENUE, revenue.targets[0], '1e16'));

    const withSaved = await step('targetAdded', request.addTargetRequest(CHURN, { kind: 'currency', name: 'Revenue kept', start: '0', target: '20000', current: '', unit: '', currencyCode: 'EUR', weight: '2' }));
    await step('targetAddRefused', request.addTargetRequest(CHURN, { kind: 'currency', name: 'In pounds', start: '', target: '100', current: '', unit: '', currencyCode: 'GBP', weight: '1' }));
    await step('targetTicked', request.addTargetRequest(CHURN, { kind: 'boolean', name: 'Exit survey sent', weight: '1' }));
    await step('targetEdited', request.editTargetRequest(CHURN, churn.targets[0], { name: 'Monthly churn rate', start: '40', target: '5', unit: '%', weight: '1' }));
    await step('targetRemoved', request.removeTargetRequest(CHURN, withSaved.targets[1].id));

    await step('archived', request.archiveRequest(created._id));
    await step('archivedRefused', request.updateRequest(created._id, { name: 'Too late' }));
    await step('readArchived', request.readRequest(created._id));
    await step('restored', request.restoreRequest(created._id));
    await step('handedOver', request.updateRequest(created._id, { ownerUserId: SAM }));
    await step('readHandedOver', request.readRequest(created._id));

    seedWork();
    const tasksForm = (name, sources) => ({ kind: 'tasks', name, weight: '1', sources });
    const delivery = (await step('tasksGoal', request.createRequest({ name: 'Deliver the release' })))._id;
    const linked = await step('tasksAdded', request.addTargetRequest(delivery, tasksForm('Release tasks', { sprintIds: [SPRINT, TEAM_LIST], taskIds: [LOOSE_TASK] })));
    await step('tasksAddedEmpty', request.addTargetRequest(delivery, tasksForm('Stretch tasks', { sprintIds: [], taskIds: [] })));
    await step('tasksNotFound', request.addTargetRequest(delivery, tasksForm('Old tasks', { sprintIds: [SPRINT, NO_LIST], taskIds: [] })));
    await step('tasksValueRefused', request.valueRequest(delivery, linked.targets[0], '3'));
    await step('tasksWouldDrop', request.updateRequest(delivery, { visibility: 'workspace' }));
    const wouldDrop = out.tasksWouldDrop.response.sources;
    const kept = await step('tasksDropped', request.sourcesRequest(delivery, linked.targets[0], request.withoutSources(linked.targets[0].sources, wouldDrop)));
    await step('tasksOpened', request.updateRequest(delivery, { visibility: 'workspace' }));
    await step('tasksNotShared', request.editTargetRequest(delivery, kept.targets[0], tasksForm('Release tasks', { sprintIds: [SPRINT, TEAM_LIST], taskIds: [LOOSE_TASK] })));
    await step('tasksRelinked', request.editTargetRequest(delivery, kept.targets[0], tasksForm('Release tasks', { sprintIds: [SPRINT, BACKLOG], taskIds: [] })));
    await step('tasksReadReader', request.readRequest(delivery), 'sam');

    Object.assign(mockDb.store[SCHEMA_TYPE.SPRINTS].find((row) => String(row._id) === BACKLOG), { private: true, AssigneeUserId: [ME] });
    minute += 11;
    await step('tasksReadStale', request.readRequest(delivery));
    const leftOut = await step('tasksReadLeftOut', request.readRequest(delivery));
    await step('tasksReadLeftOutReader', request.readRequest(delivery), 'sam');
    await step('tasksUncounted', request.sourcesRequest(delivery, leftOut.targets[0], request.withoutSources(leftOut.targets[0].sources, leftOut.targets[0].notCountedSources)));
    return out;
};

/* A target's id is made by the handler and differs on every run; the recording names them in the order they were made. */
const SEEDED = /^(6f0000000000000000000|0{12})/;
const withSteadyIds = (recorded) => {
    const text = JSON.stringify(recorded);
    const made = [...new Set(text.match(/\b[a-f0-9]{24}\b/g) || [])].filter((id) => !SEEDED.test(id));
    return JSON.parse(made.reduce((all, id, index) => all.split(id).join(`6f00000000000000000090${String(index + 1).padStart(2, '0')}`), text));
};

const names = (entry) => entry.response.data.map((goal) => goal.name);

beforeAll(() => {
    jest.useFakeTimers({ now: NOW, doNotFake: TIMERS_LEFT_REAL });
    seed();
});
afterAll(() => jest.useRealTimers());

test('the fixture the web app is tested against is what the handlers answer to the page\'s own requests', async () => {
    const recorded = withSteadyIds(await record());

    const REFUSED = {
        readMissing: 404, createRefused: 400, createRefusedGuest: 403, sharedRefused: 400, editRefused: 403, valueRefused: 403, valueTooLarge: 400, targetAddRefused: 400, archivedRefused: 409, readHandedOver: 404,
        tasksNotFound: 400, tasksValueRefused: 400, tasksWouldDrop: 400, tasksNotShared: 400,
    };
    Object.entries(recorded).forEach(([name, entry]) => {
        expect({ name, statusCode: entry.statusCode, status: entry.response.status }).toEqual({ name, statusCode: REFUSED[name] || 200, status: !REFUSED[name] });
    });

    expect(names(recorded.list)).toEqual(['Cut churn', 'Grow revenue', 'Hire the team', 'Refresh the brand']);
    expect(names(recorded.listMine)).toEqual(['Cut churn', 'Grow revenue', 'Hire the team']);
    expect(names(recorded.listArchived)).toEqual(['Launch v1']);
    expect(names(recorded.listGuest)).toEqual(['Client rollout']);
    expect(recorded.listAdmin.response.data.map((goal) => [goal.name, goal.canEdit])).toEqual([['Grow revenue', true], ['Refresh the brand', true]]);

    expect(recorded.read.response.data).toMatchObject({ name: 'Grow revenue', progressPct: 33, isOwner: true, canEdit: true, canSetValue: true, archived: false });
    expect(recorded.read.response.data.targets.map((entry) => [entry.kind, entry.progressPct, Boolean(entry.reachedAt)])).toEqual([['number', 30, false], ['currency', 0, false], ['boolean', 100, true]]);
    expect(recorded.readShared.response.data).toMatchObject({ ownerUserId: SAM, sharedWith: [], sharedWithMe: true, isOwner: false, canEdit: false, canSetValue: false });
    expect(recorded.readMissing.response).toMatchObject({ status: false, message: 'Goal not found.' });

    expect(recorded.created.request.body).toEqual({ name: 'Ship the mobile app', periodStart: '2026-10-01', periodEnd: '2026-12-31' });
    expect(recorded.created.response.data).toMatchObject({ name: 'Ship the mobile app', visibility: 'private', ownerUserId: ME, targets: [] });
    expect(recorded.createRefused.response).toMatchObject({ status: false, field: 'periodEnd' });
    expect(recorded.shared.response.data).toMatchObject({ visibility: 'people', sharedWith: [SAM, GIL] });
    expect(recorded.sharedRefused.response).toMatchObject({ status: false, field: 'sharedWith' });

    expect(recorded.valueSet.request.body).toEqual({ current: 5 });
    expect(recorded.valueSet.response.data).toMatchObject({ progressPct: 38, targets: [{ current: 5, progressPct: 50, updatedBy: ME }, {}, {}] });
    expect(recorded.valueUnticked.request.body).toEqual({ done: false });
    expect(recorded.valueUnticked.response.data.targets[2]).toMatchObject({ done: false, progressPct: 0, reachedAt: null });
    expect(recorded.valueTooLarge.response).toMatchObject({ status: false, field: 'current' });

    expect(recorded.targetAdded.request.body).toEqual({ kind: 'currency', name: 'Revenue kept', weight: 2, start: 0, target: 20000, currencyCode: 'EUR' });
    expect(recorded.targetAdded.response.data.targets[1]).toMatchObject({ kind: 'currency', currencyCode: 'EUR', start: 0, target: 20000, current: 0, weight: 2 });
    expect(recorded.targetAddRefused.response).toMatchObject({ status: false, field: 'currencyCode' });
    expect(recorded.targetTicked.request.body).toEqual({ kind: 'boolean', name: 'Exit survey sent', weight: 1 });
    expect(recorded.targetEdited.request.body).toEqual({ name: 'Monthly churn rate', target: 5 });
    expect(recorded.targetEdited.response.data.targets[0]).toMatchObject({ name: 'Monthly churn rate', start: 40, target: 5, current: 25, progressPct: 43 });
    expect(recorded.targetRemoved.response.data.targets.map((entry) => entry.name)).toEqual(['Monthly churn rate', 'Exit survey sent']);

    expect(recorded.archived.request).toEqual({ method: 'post', path: `/api/v2/goals/${recorded.created.response.data._id}/archive` });
    expect(recorded.archived.response.data.archived).toBe(true);
    expect(recorded.readArchived.response.data.archived).toBe(true);
    expect(recorded.restored.response.data.archived).toBe(false);
    expect(recorded.handedOver.response).toEqual({ status: true, statusText: 'Goal saved.', data: null });

    const counted = (entry, at = 0) => entry.response.data.targets[at];
    const withTeam = { sprintIds: [SPRINT, TEAM_LIST], taskIds: [LOOSE_TASK] };
    expect(recorded.tasksAdded.request.body).toEqual({ kind: 'tasks', name: 'Release tasks', weight: 1, sources: withTeam });
    expect(counted(recorded.tasksAdded)).toMatchObject({ kind: 'tasks', progressPct: 33, sources: withTeam, counted: { done: 2, total: 6 }, notCounted: 0, notCountedSources: { sprintIds: [], taskIds: [] }, dirty: false, updating: false });
    expect(counted(recorded.tasksAddedEmpty, 1)).toMatchObject({ kind: 'tasks', progressPct: 0, sources: { sprintIds: [], taskIds: [] }, counted: { done: 0, total: 0 }, notCounted: 0 });
    expect(recorded.tasksNotFound.response).toMatchObject({ status: false, field: 'sources.sprintIds.1', code: 'source_not_found' });
    expect(recorded.tasksValueRefused.response).toMatchObject({ status: false, field: 'current', code: 'counted_from_tasks' });
    expect(recorded.tasksWouldDrop.response).toMatchObject({ status: false, field: 'visibility', code: 'sources_would_drop', sources: { sprintIds: [TEAM_LIST], taskIds: [] } });
    expect(recorded.tasksDropped.request.body).toEqual({ sources: { sprintIds: [SPRINT], taskIds: [LOOSE_TASK] } });
    expect(counted(recorded.tasksDropped)).toMatchObject({ counted: { done: 1, total: 4 }, progressPct: 25 });
    expect(recorded.tasksOpened.response.data.visibility).toBe('workspace');
    expect(recorded.tasksNotShared.request.body).toEqual({ sources: withTeam });
    expect(recorded.tasksNotShared.response).toMatchObject({ status: false, code: 'source_not_shared', sources: { sprintIds: [TEAM_LIST], taskIds: [] } });
    expect(recorded.tasksRelinked.request.body).toEqual({ sources: { sprintIds: [SPRINT, BACKLOG], taskIds: [] } });
    expect(counted(recorded.tasksRelinked)).toMatchObject({ counted: { done: 2, total: 5 }, progressPct: 40 });
    expect(recorded.tasksReadReader.response.data).toMatchObject({ canEdit: false, canSetValue: false });
    expect(counted(recorded.tasksReadReader)).toMatchObject({ sources: { sprintIds: [SPRINT, BACKLOG], taskIds: [] }, counted: { done: 2, total: 5 }, notCounted: 0 });
    expect(counted(recorded.tasksReadReader).notCountedSources).toBeUndefined();
    expect(counted(recorded.tasksReadStale)).toMatchObject({ updating: true, counted: { done: 2, total: 5 } });
    expect(counted(recorded.tasksReadLeftOut)).toMatchObject({ updating: false, counted: { done: 1, total: 3 }, notCounted: 1, notCountedSources: { sprintIds: [BACKLOG], taskIds: [] } });
    expect(counted(recorded.tasksReadLeftOutReader)).toMatchObject({ notCounted: 1, sources: { sprintIds: [SPRINT], taskIds: [] } });
    expect(JSON.stringify(recorded.tasksReadLeftOutReader.response)).not.toContain(BACKLOG);
    expect(recorded.tasksUncounted.request.body).toEqual({ sources: { sprintIds: [SPRINT], taskIds: [] } });
    expect(counted(recorded.tasksUncounted)).toMatchObject({ notCounted: 0, counted: { done: 1, total: 3 } });

    if (process.env.UPDATE_GOALS_FIXTURE === '1') {
        fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
        fs.writeFileSync(FIXTURE, `${JSON.stringify(recorded, null, 2)}\n`);
    }
    expect(JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))).toEqual(recorded);
});
