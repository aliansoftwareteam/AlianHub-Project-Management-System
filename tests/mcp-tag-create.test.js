require('./fixtures/mcpFlagsOff');
/* Task 048: a connected agent asks for a new tag on a project. It needs the manage grant, always waits for a person,
   and once approved runs the project's own tag route as the person behind the token. Undo removes it while unused. */
process.env.STORAGE_TYPE = 'server';
const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({
    MongoDbCrudOpration: (companyId, q, method) => mockDb.crud(companyId, q, method),
    validateObjectId: (id) => /^[a-f0-9]{24}$/i.test(String(id)),
}));
jest.mock('../Config/config', () => ({ myCache: { get: () => undefined, set: () => {}, del: () => {}, keys: () => [], getTtl: () => 0, flushAll: () => {} } }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
const mockStub = () => new Proxy({}, {
    get: (target, name) => {
        if (name === 'then' || name === '__esModule') return undefined;
        target[name] = target[name] || jest.fn(() => Promise.resolve({}));
        return target[name];
    },
});
jest.mock('../Modules/Tasks/helpers/handleNotification', () => mockStub());
jest.mock('../Modules/notification/prepare-notification-data/controllerV2', () => mockStub());
jest.mock('../Modules/Company/eventController', () => mockStub());
jest.mock('../Modules/Company/controller/updateCompany', () => mockStub());
jest.mock('../Modules/notification-count/controller', () => mockStub());
jest.mock('../Modules/Comments/controller', () => mockStub());
jest.mock('../Modules/MainChats/controller', () => mockStub());
jest.mock('../Modules/LogTime/controllerV2.js', () => mockStub());
jest.mock('../Modules/CustomField/controller', () => mockStub());
jest.mock('../Modules/Project/controller/getProjectById', () => mockStub());
jest.mock('../Modules/Project/controller/getProjectList', () => mockStub());
jest.mock('../Modules/Project/controller/projectAlltaskUpdate', () => mockStub());
jest.mock('../Modules/Project/controller/getSprintFolder', () => mockStub());
jest.mock('../Modules/Project/controller/updateSprint', () => mockStub());
jest.mock('../Modules/Project/controller/getProjectFilterData', () => mockStub());
jest.mock('../Modules/Project/controller/manageGlobalFilter', () => mockStub());
jest.mock('../Modules/Project/controller/checklist', () => mockStub());
jest.mock('../Modules/Project/controller/getQueryFun', () => mockStub());
jest.mock('../Modules/Project/helpers/projectItemHistory', () => ({ recordTagDefinitionChange: jest.fn(async () => null) }));
jest.mock('../Modules/Project/helpers/projectHistory', () => ({ recordProjectChanges: jest.fn(async () => null) }));
jest.mock('../Modules/Knowledge/ingest/events', () => mockStub());
jest.mock('../utils/planHelper', () => ({ getCachedCompanyData: jest.fn(async () => ({ data: {} })) }));
jest.mock('../utils/commonFunctions.js', () => mockStub());
jest.mock('../common-storage/common-server.js', () => mockStub());
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../Modules/Tasks/helpers/completionStore', () => ({ recordWork: jest.fn(async () => null), forStatusChange: jest.fn(async () => null) }));
jest.mock('../Modules/Agents/engine/graph', () => ({ resumeGraph: jest.fn(async () => ({ resumed: false })) }));
jest.mock('../Modules/AICore/persistence', () => {
    const deleteThread = jest.fn(async () => {});
    return { deleteThread, saverFor: jest.fn(() => ({ deleteThread })), storeFor: jest.fn(() => { throw new Error('no store in this suite'); }), ready: jest.fn(async () => {}) };
});
jest.mock('../Config/jwt', () => ({ verifyCompanyMembership: jest.fn(async () => true) }));
jest.mock('../Modules/ApiTokens/controller', () => ({ verifyToken: jest.fn(), logTokenActivity: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const world = require('./fixtures/mcpWorkWorld');
const registry = require('../Modules/Agents/registry');
const actions = require('../Modules/Agents/actions');
const proposals = require('../Modules/Agents/proposals');
const memory = require('../Modules/Agents/memory');
const projectPolicy = require('../Modules/Agents/projectPolicy');
const intentPreview = require('../Modules/Agents/intentPreview');
const { undoAuditRow } = require('../Modules/Agents/undo');
const socketEmitter = require('../event/socketEventEmitter');
const tools = require('../Modules/Mcp/tools');
const scopes = require('../Modules/Mcp/scopes');
const manageTools = require('../Modules/Mcp/manageTools');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, T_OPEN, TOKEN, MISSING, BEFORE, FLAGS, TAGS, ctx, outside, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const TOOL = 'tag.create';
const GRANT = 'tasks:manage';
const NO_PROJECT = 'not_visible: that project was not found, or the person cannot open it. Ask the person which project they mean.';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];

const tagsOf = (projectId) => stored(SCHEMA_TYPE.PROJECTS, projectId).tagsArray || [];
const tagNamed = (projectId, name) => tagsOf(projectId).find((tag) => tag.tagName === name);
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const projectsNow = () => JSON.stringify(mockDb.store[SCHEMA_TYPE.PROJECTS]);
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = OWNER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid), grants: [GRANT] } };
};
const withoutGrant = (uid) => ({ ...as(uid), token: { ...as(uid).token, grants: [] } });
const filed = async (caller, args) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};

beforeEach(() => {
    seed();
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
        _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], grants: [GRANT], projectIds: [], expiresAt: new Date(Date.now() + 86400000),
    }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
    socketEmitter.emit.mockClear();
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag and the grant decide whether the tool exists', () => {
    it('off, the tool list and the registry are what they were', async () => {
        process.env.MCP_TOOLS_WORK = 'off';
        expect(await listed(as(OWNER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect(actions.rating(TOOL)).toBeNull();
        expect((await rpc(as(OWNER), TOOL, { projectId: P_OPEN, name: 'Later' })).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, it is a rated action that always waits, held to the tag permission, under the manage grant', () => {
        expect(registry.get(TOOL)).toMatchObject({ risk: 'low', undoable: true, write: true, proposeOnly: true });
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: 'task.task_tag', write: true }]);
        expect(actions.rating(TOOL)).toEqual({ write: true, reversible: true, scope: 'project', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe(GRANT);
        expect(tools.registered().find((tool) => tool.name === TOOL).grant).toBe(GRANT);
        expect(manageTools.grantOfAction(TOOL)).toBe(GRANT);
    });

    it('is listed and run only for a connection that holds the manage grant', async () => {
        expect(await listed(as(OWNER))).toContain(TOOL);
        expect(await listed(withoutGrant(OWNER))).not.toContain(TOOL);
        const before = projectsNow();
        expect(await rpc(withoutGrant(OWNER), TOOL, { projectId: P_OPEN, name: 'Later' })).toMatchObject({ isError: true, error: expect.stringMatching(/tasks:manage permission/) });
        expect(await rpc(outside(OWNER, ['tasks:write', 'projects:read']), TOOL, { projectId: P_OPEN, name: 'Later' })).toMatchObject({ isError: true });
        expect(projectsNow()).toBe(before);
        expect(waiting()).toHaveLength(0);
    });
});

describe('a tag is never added before a person has seen it', () => {
    it('files the tag as one proposal with a clean name, and adds nothing', async () => {
        const before = projectsNow();
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: '  Needs\u0007   design ', color: '#12ab9f', reason: 'Triage' });
        expect(projectsNow()).toBe(before);
        const [proposal] = waiting();
        expect(String(proposal._id)).toBe(id);
        expect(proposal).toMatchObject({ projectId: P_OPEN, source: 'mcp', requestedBy: INSIDER });
        expect(proposal.changes).toEqual([expect.objectContaining({ action: TOOL, params: { projectId: P_OPEN, name: 'Needs design', color: '#12AB9F' } })]);
    });

    it('waits for a person whatever the project is set to, and cannot be run directly', async () => {
        const actor = as(INSIDER).actor;
        const params = { projectId: P_OPEN, name: 'Direct' };
        expect(await projectPolicy.ask({ companyId: CID, actor, action: TOOL, params })).toMatchObject({ decision: 'propose' });
        await expect(actions.perform({ companyId: CID, actor, action: TOOL, params })).rejects.toThrow(/needs a person's approval first/);
        await expect(actions.perform({ companyId: CID, actor, action: TOOL, params: { ...params, __proposal: true } })).rejects.toThrow(/waits for a person's approval/);
        expect(tagNamed(P_OPEN, 'Direct')).toBeUndefined();
    });

    it('is refused in a project where agents are paused, says so, and files nothing', async () => {
        stored(SCHEMA_TYPE.PROJECTS, P_OPEN).agentLimits = { paused: true };
        expect(await rpc(as(INSIDER), TOOL, { projectId: P_OPEN, name: 'Paused' })).toMatchObject({ refused: true, reason: expect.stringMatching(/^agents are paused in this project/) });
        expect(waiting()).toHaveLength(0);
    });

    it('answers a name the project already has with that tag, in any case, and files nothing', async () => {
        expect(await rpc(as(INSIDER), TOOL, { projectId: P_OPEN, name: ' bug ' })).toEqual({
            ok: false, tagId: 'tag_bug', error: 'The project already has the tag "Bug" (tag_bug). Put it on a task with task.tags.add.',
        });
        expect(waiting()).toHaveLength(0);
    });

    it('says what is wrong with a name or a colour', async () => {
        for (const args of [{ projectId: P_OPEN, name: '' }, { projectId: P_OPEN, name: 'x'.repeat(51) }, { projectId: P_OPEN, name: '\u0007' }, { projectId: P_OPEN, name: 'Ok', color: 'red' }, { projectId: P_OPEN, name: 'Ok', extra: 1 }]) {
            expect((await rpc(as(INSIDER), TOOL, args)).rpcError).toMatchObject({ code: -32602 });
        }
        expect(waiting()).toHaveLength(0);
    });
});

describe('who may ask for a tag', () => {
    it('answers a project the person cannot open, and one outside a narrowed token, as a missing project', async () => {
        expect(await rpc(as(OWNER), TOOL, { projectId: MISSING, name: 'Nowhere' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        for (const uid of [OUTSIDER, GUEST]) {
            expect(await rpc(as(uid), TOOL, { projectId: P_PRIVATE, name: 'Secret' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        }
        expect(await rpc(as(INSIDER, { projectIds: [P_OPEN] }), TOOL, { projectId: P_PRIVATE, name: 'Nowhere' })).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(waiting()).toHaveLength(0);
    });

    it('refuses a person without the tag permission, and files nothing', async () => {
        setRule('task_tag', false, [0]);
        expect(await rpc(as(GUEST), TOOL, { projectId: P_OPEN, name: 'Guest tag' })).toMatchObject({ refused: true, reason: expect.stringMatching(/permission_denied: task\.task_tag/) });
        expect(waiting()).toHaveLength(0);
        await filed(as(OUTSIDER), { projectId: P_OPEN, name: 'Member tag' });
    });
});

describe('approving adds the tag through the project tag route', () => {
    it('adds it to the project, records it with its undo, and tells the open screens', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: 'Needs design', color: '#12ab9f' });
        const out = await approve(id);
        const made = tagNamed(P_OPEN, 'Needs design');
        expect(made).toMatchObject({ tagName: 'Needs design', tagColor: '#12AB9F', tagBgColor: '#12AB9F35', uid: expect.stringMatching(/^[a-f0-9]{12}$/) });
        expect(tagsOf(P_OPEN)).toHaveLength(TAGS.length + 1);
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true, result: { projectId: P_OPEN, tagId: made.uid, name: 'Needs design', color: '#12AB9F' } });
        expect(audits(TOOL, 'applied')[0]).toMatchObject({ entityType: 'project', entityId: P_OPEN, meta: { onBehalfOf: INSIDER, undo: { kind: 'projectTag', projectId: P_OPEN, tagId: made.uid } } });
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', companyId: CID, updatedFields: { tagsArray: 'add' } }));
        expect(await rpc(as(INSIDER), 'task.tags.add', { taskId: T_OPEN, tag: 'needs design' })).toMatchObject({ ok: true, result: { tagId: made.uid, changed: true } });
    });

    it('picks a colour when none was named', async () => {
        await approve(await filed(as(INSIDER), { projectId: P_OPEN, name: 'Plain' }));
        expect(tagNamed(P_OPEN, 'Plain').tagColor).toMatch(/^#[0-9A-F]{6}$/);
    });

    it('adds nothing when the project got a tag by that name while it waited', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: 'Late' });
        stored(SCHEMA_TYPE.PROJECTS, P_OPEN).tagsArray.push({ uid: 'tag_late', tagName: 'late', tagColor: '#000000' });
        const out = await approve(id);
        expect(out.applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/already has the tag "late"/) });
        expect(tagsOf(P_OPEN).filter((tag) => tag.tagName.toLowerCase() === 'late')).toHaveLength(1);
    });

    it('adds nothing when the person behind the token lost the tag permission', async () => {
        const id = await filed(as(OUTSIDER), { projectId: P_OPEN, name: 'Lost' });
        setRule('task_tag', false, [3]);
        await approve(id);
        expect(tagNamed(P_OPEN, 'Lost')).toBeUndefined();
    });
});

describe('two requests for one name', () => {
    it('lets the tag route add a name only while the project does not have it, in any case', async () => {
        const web = world.asPerson(world.routeTable(require('../Modules/Project/routes').init));
        const before = projectsNow();
        const out = await web('POST /api/v1/project/tags', INSIDER, { body: { id: P_OPEN, operation: 'push', items: { uid: 'tag_x', tagName: ' BUG ', tagColor: '#000000' } } });
        expect(out).toMatchObject({ code: 409, body: { status: false } });
        expect(projectsNow()).toBe(before);
        expect((await web('POST /api/v1/project/tags', INSIDER, { body: { id: P_OPEN, operation: 'push', items: { uid: 'tag_y', tagName: 'Fresh', tagColor: '#000000' } } })).code).toBe(200);
        expect(tagNamed(P_OPEN, 'Fresh')).toBeDefined();
    });

    it('adds one tag when two approvals of the same name run at once, and answers the other as already there', async () => {
        const first = await filed(as(INSIDER), { projectId: P_OPEN, name: 'Twice' });
        const second = await filed(as(OUTSIDER), { projectId: P_OPEN, name: 'twice' });
        const outs = await Promise.all([approve(first), approve(second)]);
        expect(tagsOf(P_OPEN).filter((tag) => tag.tagName.toLowerCase() === 'twice')).toHaveLength(1);
        const failed = outs.map((out) => out.applied[0]).filter((entry) => !entry.ok);
        expect(failed).toHaveLength(1);
        expect(failed[0].error).toMatch(/already has the tag "Twice"/i);
    });
});

describe('undo', () => {
    it('removes the tag while no task carries it', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: 'Short lived' });
        await approve(id);
        socketEmitter.emit.mockClear();
        const out = await undo(id);
        expect(out.results[0]).toMatchObject({ ok: true, result: { projectId: P_OPEN, removed: true, name: 'Short lived' } });
        expect(tagNamed(P_OPEN, 'Short lived')).toBeUndefined();
        expect(tagsOf(P_OPEN)).toHaveLength(TAGS.length);
        expect(socketEmitter.emit).toHaveBeenCalledWith('update', expect.objectContaining({ module: 'project', updatedFields: { tagsArray: 'remove' } }));
    });

    it('keeps a tag a task carries now, says why, and can be undone once it is taken off', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: 'In use' });
        await approve(id);
        const { uid } = tagNamed(P_OPEN, 'In use');
        stored(SCHEMA_TYPE.TASKS, T_OPEN).tagsArray = [uid];
        expect((await undo(id)).results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/"In use" was kept: a task carries it now/) });
        expect(tagNamed(P_OPEN, 'In use')).toBeDefined();

        stored(SCHEMA_TYPE.TASKS, T_OPEN).tagsArray = [];
        expect(await undoAuditRow(CID, audits(TOOL, 'applied')[0], human(OWNER))).toMatchObject({ ok: true, result: { removed: true } });
        expect(tagNamed(P_OPEN, 'In use')).toBeUndefined();
    });

    it('puts the tag back when a task takes it while it is being removed', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: 'Raced' });
        await approve(id);
        const made = { ...tagNamed(P_OPEN, 'Raced') };
        const real = mockDb.crud.getMockImplementation();
        mockDb.crud.mockImplementation(async (companyId, q, method) => {
            const out = await real(companyId, q, method);
            const update = q.data && q.data[1];
            if (q.type === SCHEMA_TYPE.PROJECTS && method === 'findOneAndUpdate' && update && update.$pull && update.$pull.tagsArray) stored(SCHEMA_TYPE.TASKS, T_OPEN).tagsArray = [made.uid];
            return out;
        });
        try {
            expect((await undo(id)).results[0]).toMatchObject({ ok: false, reason: expect.stringMatching(/"Raced" was kept: a task carries it now/) });
        } finally {
            mockDb.crud.mockImplementation(real);
        }
        expect(tagNamed(P_OPEN, 'Raced')).toEqual(made);
    });
});

describe('the preview', () => {
    const previewFor = async (uid, proposal) => (await intentPreview.forProposals(CID, uid, [proposal])).get(String(proposal._id));

    it('names the tag and its project, and shows nothing to someone who cannot open the project', async () => {
        await filed(as(INSIDER), { projectId: P_OPEN, name: 'Needs design' });
        expect(await previewFor(OUTSIDER, waiting()[0])).toEqual([{ kind: 'tag', title: 'Needs design', lines: [{ kind: 'place', project: 'Open', list: '' }] }]);
        await filed(as(INSIDER), { projectId: P_PRIVATE, name: 'Secret plans' });
        expect(await previewFor(OUTSIDER, waiting()[1])).toEqual([null]);
    });
});
