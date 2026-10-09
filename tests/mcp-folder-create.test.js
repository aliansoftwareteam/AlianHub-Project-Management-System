require('./fixtures/mcpFlagsOff');
/* Task 047, AI-run: a connected agent asks for a folder (or a subfolder) with lists made in it or moved into it.
   It waits as one proposal with one preview; approved, each part runs the web app's own route as the approver, a part
   that fails does not hide the others, and undo puts moved lists back and removes only what nobody has used since. */
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
jest.mock('../Modules/CustomField/aiFields/controller', () => mockStub());
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
const scopes = require('../Modules/Mcp/scopes');
const server = require('../Modules/Mcp/server');

const { CID, OWNER, INSIDER, OUTSIDER, GUEST, P_OPEN, P_PRIVATE, L_SECRET, TOKEN, MISSING, BEFORE, FLAGS, ctx, narrowed, readOnly, settle } = world;
const { seed, rows, stored, audits, setRule, rpcThrough, listedThrough } = world.create(mockDb);
const rpc = rpcThrough(server);
const listed = listedThrough(server);

const TOOL = 'folder.create';
const NO_PROJECT = 'not_visible: that project was not found, or the person cannot open it. Ask the person which project they mean.';
const NO_LIST = 'That list was not found in that project.';
const F_TOP = '6f0000000000000000000e01';
const F_SUB = '6f0000000000000000000e02';
const L_TWIN = '6f0000000000000000000b09';
const PEOPLE = [OWNER, INSIDER, OUTSIDER, GUEST];
const LIST_KEYS = ['project_sprint_create', 'project_sprint_name_edit', 'sprint_type_change'];
const PLAN = {
    projectId: P_OPEN,
    name: '  Launch\u0007 ',
    lists: ['Kickoff'],
    moveListIds: [L_TWIN],
    subfolders: [{ name: 'Week one', lists: ['Inner list'] }],
    reason: 'A place for the launch work',
};

const live = (row) => Number(row.deletedStatusKey || 0) === 0;
const foldersNamed = (name) => rows(SCHEMA_TYPE.FOLDERS).filter((row) => row.name === name && live(row));
const listsNamed = (name) => rows(SCHEMA_TYPE.SPRINTS).filter((row) => row.name === name && live(row));
const folderOf = (listId) => String(stored(SCHEMA_TYPE.SPRINTS, listId).folderId || '');
const waiting = () => rows(SCHEMA_TYPE.AGENT_PROPOSALS).filter((row) => row.status === 'pending');
const everythingNow = () => JSON.stringify([SCHEMA_TYPE.FOLDERS, SCHEMA_TYPE.SPRINTS, SCHEMA_TYPE.TASKS].map((type) => mockDb.store[type]));
const human = (userId) => ({ kind: 'human', userId });
const approve = (id, uid = OWNER) => proposals.approve(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const undo = (id, uid = OWNER) => proposals.undoApproval(CID, id, { decider: human(uid), isPrivileged: uid === OWNER, ip: '' });
const tokenOf = (uid) => TOKEN.replace(/.$/, String(PEOPLE.indexOf(uid) + 1));
const as = (uid, over = {}) => {
    const base = ctx(uid, over);
    return { ...base, actor: { ...base.actor, tokenId: tokenOf(uid) }, token: { ...base.token, _id: tokenOf(uid), grants: ['tasks:manage'] } };
};
const filed = async (caller, args = PLAN) => {
    const out = await rpc(caller, TOOL, args);
    expect(out).toMatchObject({ ok: false, pending: true, approval: 'pending' });
    return out.proposalId;
};
const partOf = (result, name) => result.parts.find((part) => part.part === name);

beforeEach(() => {
    const made = seed();
    const parent = rows(SCHEMA_TYPE.RULES).find((rule) => rule.isParent && rule.key === 'project');
    ['project_folder_create', 'folder_delete'].forEach((key) => mockDb.seed(SCHEMA_TYPE.RULES, {
        key, name: key, isParent: false, parentId: String(parent._id), roles: [{ key: 3, permission: true }, { key: 0, permission: false }],
    }));
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: F_TOP, name: 'Q3', projectId: P_OPEN, deletedStatusKey: 0 });
    mockDb.seed(SCHEMA_TYPE.FOLDERS, { _id: F_SUB, name: 'Week 1', projectId: P_OPEN, parentFolderId: F_TOP, deletedStatusKey: 0 });
    made.list(L_TWIN, 'Twin list', P_OPEN);
    PEOPLE.forEach((userId) => mockDb.seed(SCHEMA_TYPE.API_TOKENS, {
        _id: tokenOf(userId), userId, active: true, scopes: ['read', 'write'], grants: ['tasks:manage'], projectIds: [], expiresAt: new Date(Date.now() + 86400000),
    }));
    jest.spyOn(memory, 'rememberApprovedChanges').mockResolvedValue([]);
});
afterEach(async () => { await settle(); jest.restoreAllMocks(); });
afterAll(() => { FLAGS.forEach((flag) => { delete process.env[flag]; }); });

describe('the flag decides whether the tool exists', () => {
    it('off, the tool list and the registry are what they were', async () => {
        process.env.MCP_TOOLS_WORK = 'off';
        expect(await listed(as(OWNER))).toEqual(BEFORE);
        expect(registry.has(TOOL)).toBe(false);
        expect((await rpc(as(OWNER), TOOL, PLAN)).rpcError).toMatchObject({ code: -32601 });
    });

    it('on, it is a rated registry action that is always proposed, under the key the folder route asks for', async () => {
        expect(await listed(as(OWNER))).toContain(TOOL);
        expect(registry.get(TOOL)).toMatchObject({ risk: 'medium', undoable: true, write: true, proposeOnly: true });
        expect(registry.permissionsFor(TOOL)).toEqual([{ key: 'project.project_folder_create', write: true }]);
        expect(actions.rating(TOOL)).toEqual({ write: true, reversible: true, scope: 'project', money: false });
        expect(scopes.scopeForTool(TOOL)).toBe('tasks:manage');
    });
});

describe('a folder is never made before a person has seen it', () => {
    it('files the folder and what goes in it as one proposal, cleaned to plain text, and makes nothing', async () => {
        const before = everythingNow();
        const id = await filed(as(INSIDER));
        expect(everythingNow()).toBe(before);
        const [proposal] = waiting();
        expect(String(proposal._id)).toBe(id);
        expect(proposal).toMatchObject({ projectId: P_OPEN, source: 'mcp', requestedBy: INSIDER });
        expect(proposal.changes).toHaveLength(1);
        expect(proposal.changes[0].params).toEqual({ projectId: P_OPEN, name: 'Launch', lists: ['Kickoff'], moveListIds: [L_TWIN], subfolders: [{ name: 'Week one', lists: ['Inner list'] }] });
    });

    it('waits for a person whatever the project is set to, and cannot be run directly', async () => {
        const params = { projectId: P_OPEN, name: 'Launch' };
        expect(await projectPolicy.ask({ companyId: CID, actor: as(INSIDER).actor, action: TOOL, params })).toMatchObject({ decision: 'propose' });
        const call = (given) => actions.perform({ companyId: CID, actor: as(OWNER).actor, action: TOOL, params: given, reason: 'direct' });
        await expect(call(params)).rejects.toThrow(/has to be sent as a proposal/);
        await expect(call({ ...params, __proposal: true })).rejects.toThrow(/waits for a person's approval/);
        expect(foldersNamed('Launch')).toHaveLength(0);
    });
});

describe('who may ask for a folder', () => {
    it('files for an owner and for a member who may make every part', async () => {
        await filed(as(OWNER));
        await filed(as(OUTSIDER));
        await filed(as(INSIDER), { projectId: P_PRIVATE, name: 'Plans' });
        expect(waiting()).toHaveLength(3);
    });

    it('refuses a member without the right to a part, names the part, and files nothing', async () => {
        setRule('project_folder_create', false, [3]);
        expect(await rpc(as(OUTSIDER), TOOL, { projectId: P_OPEN, name: 'Launch' })).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: /) });
        setRule('project_folder_create', true, [3]);
        setRule('project_sprint_create', false, [3]);
        const out = await rpc(as(OUTSIDER), TOOL, PLAN);
        expect(out.reason).toMatch(/^permission_denied: .*: lists \(The permission project\.project_sprint_create is missing\.\)$/);
        expect(audits(TOOL).map((row) => row.meta.ran)).toEqual([false, false]);
        expect(waiting()).toHaveLength(0);
        await filed(as(OUTSIDER), { projectId: P_OPEN, name: 'Launch', moveListIds: [L_TWIN] });
    });

    it('refuses a guest, and a token that only reads', async () => {
        expect(await rpc(as(GUEST), TOOL, PLAN)).toMatchObject({ refused: true, reason: expect.stringMatching(/^permission_denied: /) });
        expect(await rpc(readOnly(OWNER), TOOL, PLAN)).toMatchObject({ isError: true, error: 'This connection can only read. Ask the person to connect you again and allow changes.' });
        expect(waiting()).toHaveLength(0);
    });

    it('answers a project the person cannot open, and one outside a token kept to some projects, as a missing project', async () => {
        const plan = (projectId) => ({ projectId, name: 'Launch' });
        expect(await rpc(as(OWNER), TOOL, plan(MISSING))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc(as(OUTSIDER), TOOL, plan(P_PRIVATE))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(await rpc({ ...as(INSIDER), projectIds: narrowed(INSIDER, [P_OPEN]).projectIds }, TOOL, plan(P_PRIVATE))).toMatchObject({ refused: true, reason: NO_PROJECT });
        expect(waiting()).toHaveLength(0);
    });

    it('answers a list the person cannot open as a list that is not there, and a folder that cannot take a subfolder', async () => {
        const plan = (over) => ({ projectId: P_OPEN, name: 'Launch', ...over });
        expect(await rpc(as(OUTSIDER), TOOL, plan({ moveListIds: [L_SECRET] }))).toEqual({ ok: false, error: `moveListIds: ${NO_LIST} (${L_SECRET})` });
        expect(await rpc(as(OUTSIDER), TOOL, plan({ moveListIds: [MISSING] }))).toEqual({ ok: false, error: `moveListIds: ${NO_LIST} (${MISSING})` });
        expect(await rpc(as(OWNER), TOOL, plan({ parentFolderId: F_SUB }))).toMatchObject({ ok: false, error: expect.stringMatching(/nest one level/) });
        expect(await rpc(as(OWNER), TOOL, plan({ parentFolderId: MISSING }))).toMatchObject({ ok: false, error: expect.stringMatching(/not in this project/) });
        expect(waiting()).toHaveLength(0);
        await filed(as(INSIDER), plan({ moveListIds: [L_SECRET] }));
    });

    it('says what is wrong with a request', async () => {
        const bad = async (over) => (await rpc(as(OWNER), TOOL, { projectId: P_OPEN, name: 'Launch', ...over })).rpcError;
        expect(await bad({ name: '   ' })).toMatchObject({ code: -32602, message: expect.stringMatching(/needs a name/) });
        expect(await bad({ parentFolderId: F_TOP, subfolders: [{ name: 'Deeper' }] })).toMatchObject({ code: -32602, message: expect.stringMatching(/one level deep/) });
        expect(await bad({ subfolders: Array.from({ length: 6 }, (v, at) => ({ name: `S${at}` })) })).toMatchObject({ code: -32602 });
        expect(await bad({ subfolders: [{ name: 'Week' }, { name: ' week ' }] })).toMatchObject({ code: -32602, message: expect.stringMatching(/appears twice/) });
        expect(await bad({ moveListIds: [L_TWIN], subfolders: [{ name: 'Week', moveListIds: [L_TWIN] }] })).toMatchObject({ code: -32602, message: expect.stringMatching(/one folder only/) });
        expect(await bad({ lists: ['Kickoff', 'kickoff'] })).toMatchObject({ code: -32602, message: expect.stringMatching(/appears twice/) });
        expect(await bad({ delete: true })).toMatchObject({ code: -32602 });
        expect(waiting()).toHaveLength(0);
    });
});

describe('approving makes the folder as the web app would, as the person who approved', () => {
    it('makes the folder, its subfolder and their lists, moves the list in, and says what each part made', async () => {
        const id = await filed(as(INSIDER));
        const asked = mockDb.calls.length;
        const out = await approve(id);
        expect(out.error).toBeUndefined();
        expect(out.applied[0]).toMatchObject({ action: TOOL, ok: true });
        const { result } = out.applied[0];
        const [top] = foldersNamed('Launch');
        const [sub] = foldersNamed('Week one');
        expect(String(top.projectId)).toBe(P_OPEN);
        expect(top.parentFolderId).toBeUndefined();
        expect(String(sub.parentFolderId)).toBe(String(top._id));
        expect(result).toMatchObject({ projectId: P_OPEN, folderId: String(top._id), name: 'Launch', made: 5, notMade: [] });
        expect(result.parts.map((part) => [part.part, part.ok])).toEqual([['folders', true], ['lists', true], ['moves', true]]);
        expect(String(listsNamed('Kickoff')[0].folderId)).toBe(String(top._id));
        expect(String(listsNamed('Inner list')[0].folderId)).toBe(String(sub._id));
        expect(folderOf(L_TWIN)).toBe(String(top._id));
        expect(partOf(result, 'moves').items).toEqual([{ sprintId: L_TWIN, folder: 'Launch', name: 'Twin list', folderId: String(top._id), previous: '', made: true }]);
        expect(socketEmitter.emit).toHaveBeenCalledWith('insert', { type: 'insert', companyId: CID, module: 'folders', data: { _id: String(top._id) } });
        expect(audits(TOOL, 'applied')[0]).toMatchObject({ entityType: 'project', entityId: P_OPEN, meta: { onBehalfOf: INSIDER, undo: { kind: 'folder', projectId: P_OPEN } } });
        expect([...new Set(mockDb.calls.slice(asked).map((call) => String(call.companyId)))].sort()).toEqual([CID, 'global'].sort());
    });

    it('makes a subfolder of a folder that exists', async () => {
        const out = await approve(await filed(as(INSIDER), { projectId: P_OPEN, name: 'Week 2', parentFolderId: F_TOP, lists: ['Monday'] }));
        expect(out.applied[0].ok).toBe(true);
        expect(String(foldersNamed('Week 2')[0].parentFolderId)).toBe(F_TOP);
        expect(String(listsNamed('Monday')[0].folderId)).toBe(String(foldersNamed('Week 2')[0]._id));
    });

    it('refuses an approver who may not make a folder by hand, and makes nothing', async () => {
        const id = await filed(as(INSIDER));
        const before = everythingNow();
        expect(await approve(id, GUEST)).toMatchObject({ status: 403, error: expect.stringMatching(/approver may not/) });
        expect(everythingNow()).toBe(before);
        expect(waiting()).toHaveLength(1);
    });

    it('makes for the approver only the parts the approver may make by hand', async () => {
        setRule('project_folder_create', true, [3, 0]);
        LIST_KEYS.forEach((key) => setRule(key, false, [0]));
        const out = await approve(await filed(as(INSIDER)), GUEST);
        const { result } = out.applied[0];
        expect(result.parts.map((part) => [part.part, part.ok])).toEqual([['folders', true], ['lists', false], ['moves', false]]);
        expect(partOf(result, 'lists').items[0].error).toMatch(/The person approving may not make this part: The permission project\.project_sprint_create is missing/);
        expect(result.notMade.map((entry) => [entry.part, entry.name])).toEqual([['lists', 'Kickoff'], ['lists', 'Inner list'], ['moves', '']]);
        expect(foldersNamed('Launch')).toHaveLength(1);
        expect(listsNamed('Kickoff')).toHaveLength(0);
        expect(folderOf(L_TWIN)).toBe('');
    });

    it('leaves where it is a list the approver cannot open, and asks the person behind the token again', async () => {
        const hidden = await approve(await filed(as(INSIDER), { projectId: P_OPEN, name: 'Hidden', moveListIds: [L_SECRET] }), OUTSIDER);
        expect(partOf(hidden.applied[0].result, 'moves').items).toEqual([{ sprintId: L_SECRET, folder: 'Hidden', made: false, error: 'That list was not found in that project. Check lists.list or ask the person which list they mean.' }]);
        expect(folderOf(L_SECRET)).toBe('');

        const id = await filed(as(OUTSIDER), { projectId: P_OPEN, name: 'Later', lists: ['Kickoff'] });
        setRule('project_sprint_create', false, [3]);
        const later = await approve(id);
        expect(partOf(later.applied[0].result, 'lists')).toMatchObject({ ok: false, items: [{ name: 'Kickoff', made: false, error: expect.stringMatching(/^permission_denied/) }] });

        const gone = await filed(as(OUTSIDER), { projectId: P_OPEN, name: 'Never' });
        setRule('project_folder_create', false, [3]);
        expect((await approve(gone)).applied[0]).toMatchObject({ ok: false, error: expect.stringMatching(/permission_denied/) });
        expect(foldersNamed('Never')).toHaveLength(0);
    });

    it('refuses the approval when the token that asked has since been kept to other projects', async () => {
        const id = await filed(as(INSIDER));
        stored(SCHEMA_TYPE.API_TOKENS, tokenOf(INSIDER)).projectIds = [P_PRIVATE];
        expect(await approve(id)).toMatchObject({ status: 403, error: expect.stringMatching(/outside the token's project list/) });
        expect(foldersNamed('Launch')).toHaveLength(0);
    });
});

describe('undo takes back what the plan made', () => {
    it('puts the moved list back and removes the lists and folders it made', async () => {
        const id = await filed(as(INSIDER));
        await approve(id);
        const out = await undo(id);
        expect(out.results[0]).toMatchObject({ ok: true, result: { projectId: P_OPEN, movedBack: ['Twin list'], removed: { lists: ['Inner list', 'Kickoff'], folders: ['Week one', 'Launch'] } } });
        expect(foldersNamed('Launch')).toHaveLength(0);
        expect(foldersNamed('Week one')).toHaveLength(0);
        expect(listsNamed('Kickoff')).toHaveLength(0);
        expect(folderOf(L_TWIN)).toBe('');
        expect(foldersNamed('Q3')).toHaveLength(1);
        expect(listsNamed('Open list')).toHaveLength(1);
    });

    it('leaves a folder that holds a list a person made since, says why, and can be undone again', async () => {
        const id = await filed(as(INSIDER));
        await approve(id);
        const byHand = mockDb.seed(SCHEMA_TYPE.SPRINTS, { name: 'By hand', projectId: P_OPEN, folderId: String(foldersNamed('Week one')[0]._id), deletedStatusKey: 0 });
        const out = await undo(id);
        expect(out.results[0]).toMatchObject({ ok: false, reason: 'The folder "Week one" was kept: it holds a list now; The folder "Launch" was kept: it holds a folder now' });
        expect(foldersNamed('Launch')).toHaveLength(1);
        expect(listsNamed('By hand')).toHaveLength(1);
        expect(listsNamed('Kickoff')).toHaveLength(0);
        expect(folderOf(L_TWIN)).toBe('');

        byHand.deletedStatusKey = 1;
        const again = await undoAuditRow(CID, audits(TOOL, 'applied')[0], human(OWNER));
        expect(again).toMatchObject({ ok: true, result: { movedBack: [], removed: { lists: [], folders: ['Week one', 'Launch'] } } });
        expect(foldersNamed('Launch')).toHaveLength(0);
    });

    it('leaves a list that holds tasks now, and a folder the person undoing may not delete', async () => {
        const id = await filed(as(INSIDER), { projectId: P_OPEN, name: 'Launch', lists: ['Kickoff'] });
        await approve(id);
        mockDb.seed(SCHEMA_TYPE.TASKS, { TaskName: 'Planned', ProjectID: P_OPEN, sprintId: String(listsNamed('Kickoff')[0]._id), CompanyId: CID, statusKey: 1, deletedStatusKey: 0 });
        expect((await undo(id)).results[0].reason).toMatch(/^The list "Kickoff" was kept: .*tasks.*; The folder "Launch" was kept: it holds a list now$/);

        const other = await filed(as(INSIDER), { projectId: P_OPEN, name: 'Empty' });
        await approve(other, INSIDER);
        setRule('folder_delete', false, [3]);
        expect((await undo(other, INSIDER)).results[0]).toMatchObject({ ok: false, reason: 'The folder "Empty" was kept: The person is not allowed to delete a folder in this project.' });
        expect(foldersNamed('Empty')).toHaveLength(1);
    });
});

describe('the preview lists every part', () => {
    const previewFor = async (uid, proposal) => (await intentPreview.forProposals(CID, uid, [proposal])).get(String(proposal._id));

    it('names the project, the lists made, the lists moved in that the viewer can open, and each subfolder', async () => {
        await filed(as(INSIDER), { ...PLAN, moveListIds: [L_TWIN, L_SECRET] });
        expect(await previewFor(OUTSIDER, waiting()[0])).toEqual([{
            kind: 'folder',
            title: 'Launch',
            lines: [
                { kind: 'place', project: 'Open', list: '' },
                { kind: 'newLists', names: ['Kickoff'] },
                { kind: 'movedLists', names: ['Twin list'], others: 1 },
                { kind: 'subfolder', name: 'Week one' },
                { kind: 'newLists', names: ['Inner list'] },
            ],
        }]);
        expect((await previewFor(INSIDER, waiting()[0]))[0].lines[2]).toEqual({ kind: 'movedLists', names: ['Twin list', 'Private list'], others: 0 });
    });

    it('names the folder a subfolder goes in, and lists nothing for someone who cannot open the project', async () => {
        await filed(as(INSIDER), { projectId: P_OPEN, name: 'Week 2', parentFolderId: F_TOP });
        expect((await previewFor(GUEST, waiting()[0]))[0].lines).toEqual([{ kind: 'place', project: 'Open', list: '' }, { kind: 'inFolder', name: 'Q3' }]);
        await filed(as(INSIDER), { projectId: P_PRIVATE, name: 'Secret plans' });
        expect(await previewFor(OUTSIDER, waiting()[1])).toEqual([null]);
    });
});
