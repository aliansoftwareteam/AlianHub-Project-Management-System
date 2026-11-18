process.env.STORAGE_TYPE = 'server';
jest.setTimeout(30000);
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../common-storage/common-server.js', () => ({ handleStoredFileCopy: jest.fn(), handleTaskAttachmentsDuplicateFunctionality: jest.fn() }));
jest.mock('../Modules/notification-count/controller', () => ({ updateUnReadCommentsCountFun: jest.fn(async () => ({})) }));
jest.mock('../Modules/AICore/aiSwitch', () => ({ AI_OFF: 'ai_off', allowed: jest.fn(async () => true), assertAllowed: jest.fn(async () => {}), isAiOff: () => false }));
jest.mock('../Modules/AICore/usage', () => ({ checkConfiguredModelPriced: () => ({ ok: true, reason: '' }), summarize: jest.fn(() => ({ costUsd: 0, totalTokens: 0, model: 'm' })) }));
jest.mock('../Modules/Knowledge/ingest/events', () => ({ publishCommentChanged: jest.fn(), publishGuideSaved: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const world = require('./fixtures/accessWorld');
const ctrl = require('../Modules/Agents/controller');
const skillsCtrl = require('../Modules/Agents/skillsController');
const runs = require('../Modules/Agents/runs');
const triggers = require('../Modules/Agents/triggers');
const chatAgents = require('../Modules/Agents/chatAgents');
const skillRecord = require('../Modules/Agents/skillRecord');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');

const { CID, OWNER, ADMIN, INSIDER, OUTSIDER, GUEST, T_OPEN } = world;
const { seed, rows, task } = world.create(mockDb);

const TEAM = '6f0000000000000000000e01';
const PROMPT = { partials: ['json_only'], instructions: 'Summarise the task.', template: '{{gather.task.title}}', output: '{"summary":"..."}' };

const res = () => { const r = { code: 200, body: null }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; r.json = r.send; return r; };
const req = (uid, over = {}) => ({ headers: { companyid: CID }, aud: CID, params: {}, query: {}, body: {}, uid, ip: '', ...over });
const call = async (handler, request) => { const r = res(); await handler(request, r); await world.settle(); return r; };

const agentRow = (id) => rows(SCHEMA_TYPE.AGENTS).find((row) => String(row._id) === String(id));
// The fake keeps the company row and its global copy in one store; the copy carries notificationId.
const notices = (changeType) => rows(SCHEMA_TYPE.NOTIFICATIONS).filter((row) => row.changeType === changeType && !row.notificationId);
const revisionsOf = (id) => rows(SCHEMA_TYPE.AGENT_REVISIONS).filter((row) => String(row.agentId) === String(id));

/* What a member's role holds on an AI row: true Read & Write, false Read, null nothing, a number for the skill risk. */
const grant = (key, permission) => {
    const rule = rows(SCHEMA_TYPE.RULES).find((row) => row.key === key);
    rule.roles = [...rule.roles.filter((role) => role.key !== 3), { key: 3, permission }];
};

const create = async (uid, body) => call(ctrl.createAgent, req(uid, { body: { name: 'Standup writer', autonomy: 1, spendCapUsd: 5, ...body } }));

const dataSkill = (over = {}) => validateSkill({ key: 'team.digest', name: 'Digest', inputs: [], gather: [{ reader: 'task' }], prompt: PROMPT, emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }], ...over }).value;

beforeAll(() => require('../Modules/AICore/persistence').useInMemory());

beforeEach(() => {
    seed();
    jest.clearAllMocks();
    mockDb.seed(SCHEMA_TYPE.TEAMS_MANAGEMENT, { _id: TEAM, name: 'Mobile', assigneeUsersArray: [OUTSIDER] });
});

describe('building an agent by role', () => {
    it('refuses a member whose role does not build agents', async () => {
        const r = await create(INSIDER);
        expect(r.code).toBe(403);
        expect(r.body.permission).toBeUndefined();
        expect(rows(SCHEMA_TYPE.AGENTS)).toHaveLength(0);
    });

    it('saves a member\'s agent as private and waiting, and tells every owner and admin', async () => {
        grant('ai_agents', true);
        const r = await create(INSIDER);

        expect(r.body).toMatchObject({ status: true, statusText: 'Agent saved. It waits for an Owner or an Admin to approve it.' });
        expect(r.body.data).toMatchObject({ ownerId: INSIDER, visibility: 'private', approval: { state: 'pending', requestedBy: INSIDER } });
        expect(notices('agent_approval_requested').map((row) => row.receiverID).sort()).toEqual([OWNER, ADMIN].sort());
        expect(notices('agent_approval_requested')[0].changeData).toMatchObject({ kind: 'agent', agentName: 'Standup writer' });
        expect(rows(SCHEMA_TYPE.AUDIT_LOGS).some((row) => row.action === 'agent.approval_requested')).toBe(true);
    });

    it('lets an owner\'s agent work at once, with no request', async () => {
        const r = await create(OWNER);
        expect(r.body.statusText).toBe('Agent created.');
        expect(r.body.data.approval).toBeUndefined();
        expect(notices('agent_approval_requested')).toHaveLength(0);
    });

    it('keeps an agent that waits from running by every road', async () => {
        grant('ai_agents', true);
        const { body } = await create(INSIDER, { visibility: 'everyone' });
        const agent = agentRow(body.data._id);

        expect(await runs.canStart(agent, { companyId: CID })).toMatchObject({ ok: false, code: 'awaiting_approval' });
        expect((await triggers.runnableAgents(CID, INSIDER, task(T_OPEN))).map((a) => String(a._id))).not.toContain(String(agent._id));
        expect((await chatAgents.usableAgents(CID, INSIDER)).map((a) => String(a._id))).not.toContain(String(agent._id));
        const start = await call(ctrl.startRun, req(INSIDER, { body: { agentId: String(agent._id), taskId: T_OPEN } }));
        expect(start.code).toBe(409);
    });
});

describe('an owner or admin answers', () => {
    const waiting = async () => {
        grant('ai_agents', true);
        return String((await create(INSIDER, { visibility: 'everyone' })).body.data._id);
    };

    it('approves: the agent can run, the creator is told, and a second answer is refused', async () => {
        const id = await waiting();
        const r = await call(ctrl.decideAgent(true), req(ADMIN, { params: { id } }));

        expect(r.body).toMatchObject({ status: true, data: { approval: { state: 'approved', decidedBy: ADMIN } } });
        expect(await runs.canStart(agentRow(id), { companyId: CID })).toMatchObject({ ok: true });
        expect(notices('agent_approval_decided')).toEqual([expect.objectContaining({ receiverID: INSIDER, changeData: expect.objectContaining({ approved: true, kind: 'agent' }) })]);
        expect((await call(ctrl.decideAgent(false), req(OWNER, { params: { id }, body: { reason: 'Late' } }))).code).toBe(409);
    });

    it('declines only with a reason, and the creator can change the agent and send it again', async () => {
        const id = await waiting();
        expect((await call(ctrl.decideAgent(false), req(OWNER, { params: { id } }))).code).toBe(400);

        const declined = await call(ctrl.decideAgent(false), req(OWNER, { params: { id }, body: { reason: 'It reaches every project' } }));
        expect(declined.body.data.approval).toMatchObject({ state: 'declined', reason: 'It reaches every project' });
        expect(notices('agent_approval_decided')[0].changeData).toMatchObject({ approved: false, reason: 'It reaches every project' });
        expect(await runs.canStart(agentRow(id), { companyId: CID })).toMatchObject({ ok: false, code: 'awaiting_approval' });

        const resent = await call(ctrl.updateAgent, req(INSIDER, { params: { id }, body: { projectIds: [world.P_OPEN] } }));
        expect(resent.body.statusText).toMatch(/sent again/);
        expect(agentRow(id).approval.state).toBe('pending');
    });

    it('refuses a member, even the creator, and an agent token', async () => {
        const id = await waiting();
        expect((await call(ctrl.decideAgent(true), req(INSIDER, { params: { id } }))).code).toBe(403);
        expect((await call(ctrl.decideAgent(true), req(OWNER, { params: { id }, apiToken: { _id: 't1', kind: 'agent', userId: OWNER, name: 'Claude' } }))).code).toBe(403);
        expect(agentRow(id).approval.state).toBe('pending');
    });
});

describe('a change to an approved agent', () => {
    const approved = async (body = {}) => {
        grant('ai_agents', true);
        const id = String((await create(INSIDER, { visibility: 'everyone', ...body })).body.data._id);
        await call(ctrl.decideAgent(true), req(OWNER, { params: { id } }));
        return id;
    };

    it('waits, while the agent keeps working as approved; promoting it puts it live and tells the creator', async () => {
        const id = await approved();
        const r = await call(ctrl.updateAgent, req(INSIDER, { params: { id }, body: { autonomy: 3 } }));

        expect(r.body.statusText).toMatch(/waits for an Owner or an Admin/);
        expect(agentRow(id).autonomy).toBe(1);
        const candidate = revisionsOf(id).find((row) => row.state === 'candidate');
        expect(candidate).toMatchObject({ requestedApproval: true, createdBy: INSIDER, snapshot: expect.objectContaining({ autonomy: 3 }) });
        expect(notices('agent_approval_requested').some((row) => row.changeData.kind === 'edit')).toBe(true);

        const listed = await call(ctrl.listAgents, req(OWNER));
        expect(listed.body.data.find((a) => String(a._id) === id).pendingEdit).toMatchObject({ n: candidate.n, createdBy: INSIDER });

        await call(ctrl.promoteRevision, req(OWNER, { params: { id, n: String(candidate.n) } }));
        expect(agentRow(id).autonomy).toBe(3);
        expect(notices('agent_approval_decided').some((row) => row.receiverID === INSIDER && row.changeData.kind === 'edit' && row.changeData.approved)).toBe(true);
    });

    it('declined, leaves the live agent as it was', async () => {
        const id = await approved();
        await call(ctrl.updateAgent, req(INSIDER, { params: { id }, body: { autonomy: 3 } }));
        const { n } = revisionsOf(id).find((row) => row.state === 'candidate');

        expect((await call(ctrl.declineRevision, req(OWNER, { params: { id, n: String(n) } }))).code).toBe(400);
        const r = await call(ctrl.declineRevision, req(OWNER, { params: { id, n: String(n) }, body: { reason: 'Keep it at L1' } }));

        expect(r.body.data.revision).toMatchObject({ state: 'declined', declineReason: 'Keep it at L1' });
        expect(agentRow(id).autonomy).toBe(1);
        expect((await call(ctrl.promoteRevision, req(OWNER, { params: { id, n: String(n) } }))).code).toBe(409);
    });

    it('narrowing who may use it takes effect at once; widening it waits', async () => {
        const id = await approved();
        const narrowed = await call(ctrl.updateAgent, req(INSIDER, { params: { id }, body: { visibility: 'private' } }));
        expect(narrowed.body.statusText).toBe('Agent updated.');
        expect(agentRow(id).visibility).toBe('private');

        const widened = await call(ctrl.updateAgent, req(INSIDER, { params: { id }, body: { visibility: 'everyone' } }));
        expect(widened.body.statusText).toMatch(/waits/);
        expect(agentRow(id).visibility).toBe('private');
    });

    it('is refused for a member who did not make the agent', async () => {
        const id = await approved();
        const r = await call(ctrl.updateAgent, req(OUTSIDER, { params: { id }, body: { autonomy: 2 } }));
        expect(r.code).toBe(403);
        expect((await call(ctrl.setPaused(true), req(OUTSIDER, { params: { id } }))).code).toBe(403);
        expect((await call(ctrl.setPaused(true), req(INSIDER, { params: { id } }))).body.status).toBe(true);
    });

    it('goes live at once when an owner makes it', async () => {
        const id = await approved();
        await call(ctrl.updateAgent, req(OWNER, { params: { id }, body: { autonomy: 2 } }));
        expect(agentRow(id).autonomy).toBe(2);
    });
});

describe('who sees and uses an agent', () => {
    const live = async (body) => {
        const id = String((await create(OWNER, body)).body.data._id);
        return id;
    };
    const ids = (list) => list.map((a) => String(a._id));

    it('a private agent is seen by its creator, owners, admins and roles that see every agent, and used by its creator alone', async () => {
        grant('ai_agents', true);
        const id = String((await create(INSIDER)).body.data._id);
        await call(ctrl.decideAgent(true), req(OWNER, { params: { id } }));

        expect(ids((await call(ctrl.listAgents, req(OWNER))).body.data)).toContain(id);
        expect(ids((await call(ctrl.listAgents, req(INSIDER))).body.data)).toContain(id);
        grant('ai_agents', null);
        expect(ids((await call(ctrl.listAgents, req(OUTSIDER))).body.data)).not.toContain(id);
        grant('ai_agents', false);
        expect(ids((await call(ctrl.listAgents, req(OUTSIDER))).body.data)).toContain(id);

        expect(ids(await triggers.runnableAgents(CID, INSIDER, task(T_OPEN)))).toContain(id);
        expect(ids(await triggers.runnableAgents(CID, OUTSIDER, task(T_OPEN)))).not.toContain(id);
        expect(ids(await triggers.runnableAgents(CID, OWNER, task(T_OPEN)))).not.toContain(id);
        expect((await call(ctrl.startRun, req(OUTSIDER, { body: { agentId: id, taskId: T_OPEN } }))).code).toBe(403);
    });

    it('a shared agent is offered to the people and team members it names, and to nobody else', async () => {
        const id = await live({ visibility: 'shared', sharedWith: { userIds: [], teamIds: [TEAM] } });
        expect(ids(await chatAgents.usableAgents(CID, OUTSIDER))).toContain(id);
        expect(ids(await chatAgents.usableAgents(CID, INSIDER))).not.toContain(id);

        rows(SCHEMA_TYPE.TEAMS_MANAGEMENT)[0].assigneeUsersArray = [INSIDER];
        expect(ids(await chatAgents.usableAgents(CID, INSIDER))).toContain(id);
        expect(ids(await chatAgents.usableAgents(CID, OUTSIDER))).not.toContain(id);
    });

    it('a share that names someone who is not a member is refused', async () => {
        const r = await create(OWNER, { visibility: 'shared', sharedWith: { userIds: ['6f00000000000000000000ff'] } });
        expect(r.code).toBe(400);
        expect((await create(OWNER, { visibility: 'shared', sharedWith: {} })).code).toBe(400);
        expect((await create(OWNER, { visibility: 'somewhere' })).code).toBe(400);
    });

    it('an agent made before sharing existed is everyone\'s', async () => {
        const old = mockDb.seed(SCHEMA_TYPE.AGENTS, { name: 'Old', ownerId: OWNER, autonomy: 1, paused: false, deletedStatusKey: 0 });
        expect(ids(await triggers.runnableAgents(CID, OUTSIDER, task(T_OPEN)))).toContain(String(old._id));
        expect(ids((await call(ctrl.listAgents, req(OUTSIDER))).body.data)).toContain(String(old._id));
    });

    it('a role without Work with agents is offered none', async () => {
        const id = await live({ visibility: 'everyone' });
        grant('ai_agent_use', null);
        expect(await triggers.runnableAgents(CID, INSIDER, task(T_OPEN))).toEqual([]);
        expect(await chatAgents.usableAgents(CID, INSIDER)).toEqual([]);
        expect((await call(ctrl.startRun, req(INSIDER, { body: { agentId: id, taskId: T_OPEN } }))).code).toBe(403);
    });

    it('every agent names who made it', async () => {
        await live({ visibility: 'everyone' });
        const listed = await call(ctrl.listAgents, req(INSIDER));
        expect(listed.body.data[0].ownerName).toBe('Olive Owner');
    });
});

describe('skills by role', () => {
    it('refuses an agent with a skill riskier than the member\'s role allows', async () => {
        grant('ai_agents', true);
        await call(skillsCtrl.createSkill, req(OWNER, { body: dataSkill({ key: 'team.assigner', name: 'Assigner', risk: 'high' }) }));
        const skills = [{ key: 'team.assigner' }];
        expect(await skillRecord.skillsAboveRisk(CID, skills, 'low')).toEqual([{ key: 'team.assigner', name: 'Assigner', risk: 'high' }]);
        expect(await skillRecord.skillsAboveRisk(CID, skills, 'high')).toEqual([]);

        const r = await create(INSIDER, { skills });
        expect(r.code).toBe(400);
        expect(r.body.code).toBe('skill_risk');

        grant('ai_skill_risk', 3);
        expect((await create(INSIDER, { skills })).body.status).toBe(true);
    });

    it('a member\'s skill stays off until an owner or admin approves it, and their change to a live one waits', async () => {
        grant('ai_skills', true);
        const created = await call(skillsCtrl.createSkill, req(INSIDER, { body: dataSkill() }));
        expect(created.code).toBe(201);
        expect(created.body.data).toMatchObject({ enabled: false, approval: { state: 'pending', requestedBy: INSIDER } });
        expect(await skillRecord.checkAgentSkills(CID, ['team.digest'])).toEqual([expect.objectContaining({ code: 'skill_not_approved' })]);
        expect(notices('agent_approval_requested').some((row) => row.changeData.kind === 'skill')).toBe(true);

        expect((await call(skillsCtrl.decideSkill(true), req(INSIDER, { params: { key: 'team.digest' } }))).code).toBe(403);
        const approved = await call(skillsCtrl.decideSkill(true), req(ADMIN, { params: { key: 'team.digest' } }));
        expect(approved.body.data).toMatchObject({ enabled: true, approval: { state: 'approved' } });
        expect(await skillRecord.checkAgentSkills(CID, ['team.digest'])).toEqual([]);

        await call(skillsCtrl.updateSkill, req(INSIDER, { params: { key: 'team.digest' }, body: { name: 'Team digest' } }));
        expect(rows(SCHEMA_TYPE.AGENT_SKILLS)[0]).toMatchObject({ name: 'Digest', pendingChange: expect.objectContaining({ requestedBy: INSIDER }) });
        await call(skillsCtrl.decideSkill(true), req(OWNER, { params: { key: 'team.digest' } }));
        expect(rows(SCHEMA_TYPE.AGENT_SKILLS)[0]).toMatchObject({ name: 'Team digest', enabled: true, pendingChange: null });
    });

    it('a member changes only the skills they wrote', async () => {
        grant('ai_skills', true);
        await call(skillsCtrl.createSkill, req(OWNER, { body: dataSkill() }));
        expect((await call(skillsCtrl.updateSkill, req(INSIDER, { params: { key: 'team.digest' }, body: { name: 'Mine' } }))).code).toBe(403);
        expect((await call(skillsCtrl.retireSkill, req(INSIDER, { params: { key: 'team.digest' } }))).code).toBe(403);
    });

    it('the library is for roles that see skills or build agents', async () => {
        expect((await call(skillsCtrl.listSkills, req(GUEST))).code).toBe(403);
        grant('ai_agents', true);
        expect((await call(skillsCtrl.listSkills, req(INSIDER))).body.status).toBe(true);
    });
});

describe('Ask AI and writing help', () => {
    const routes = {};
    const register = (method) => (routePath, ...handlers) => { routes[`${method} ${routePath}`] = handlers.flat(); };
    require('../Modules/AI/routes').init({ get: register('GET'), post: register('POST'), put: register('PUT'), delete: register('DELETE'), use: () => {} });
    const guarded = (route) => routes[route].some((handler) => handler.permission === 'artificial_intelligence.ai_assistant');

    it.each([
        'POST /api/v1/ai/ask', 'POST /api/v1/ai/ask/stream', 'POST /api/v1/ai/description', 'POST /api/v1/ai/task-summary', 'POST /api/v1/ai/transcribe',
        'POST /api/v1/ai/meeting-notes', 'POST /api/v1/ai/notes-to-tasks', 'POST /api/v1/ai/chat-ask', 'POST /api/v1/generatePrompt', 'POST /api/v1/generatePromptChat',
    ])('%s is behind the Ask AI row', (route) => {
        expect(guarded(route)).toBe(true);
    });

    it.each(['GET /api/v1/ai/ask/threads', 'GET /api/v1/ai/memory', 'PUT /api/v1/ai/feedback'])('%s, a person\'s own data, is not', (route) => {
        expect(guarded(route)).toBe(false);
    });

    it('refuses a member whose role does not include it, and lets one whose role does', async () => {
        const guard = routes['POST /api/v1/ai/ask'].find((handler) => handler.permission === 'artificial_intelligence.ai_assistant');
        const run = async (uid) => { const r = res(); let passed = false; await guard(req(uid), r, () => { passed = true; }); return { passed, r }; };
        expect((await run(INSIDER)).passed).toBe(true);
        grant('ai_assistant', null);
        const refused = await run(INSIDER);
        expect(refused.passed).toBe(false);
        expect(refused.r.code).toBe(403);
        expect((await run(GUEST)).passed).toBe(false);
        expect((await run(OWNER)).passed).toBe(true);
    });
});

describe('the notice rows', () => {
    it('are written with their global copy for the bell', async () => {
        grant('ai_agents', true);
        await create(INSIDER);
        const globalRows = rows(dbCollections.NOTIFICATIONS).filter((row) => row.changeType === 'agent_approval_requested' && row.notificationId);
        expect(globalRows.map((row) => row.receiverID).sort()).toEqual([OWNER, ADMIN].sort());
    });
});
