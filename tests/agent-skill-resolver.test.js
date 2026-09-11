const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
jest.mock('../Config/permissionGuard', () => ({ ROLE_OWNER: 1, ROLE_ADMIN: 2, getRoleType: jest.fn(async () => 1), isPrivileged: (r) => r === 1 || r === 2 }));
jest.mock('../Modules/Agents/actor', () => ({ resolveActor: jest.fn(async (req) => ({ kind: req.agent ? 'agent' : 'human', userId: req.uid || null })), isAgent: (a) => a && a.kind === 'agent' }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { dbCollections } = require('../Config/collections');
const { getRoleType } = require('../Config/permissionGuard');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const skillRecord = require('../Modules/Agents/skillRecord');
const codeSkills = require('../Modules/Agents/skills');
const { skillSlugOf } = require('../Modules/Agents/runs');
const ctrl = require('../Modules/Agents/skillsController');
const { agentSkillsSchema } = require('../utils/mongo-handler/createSchema');

const C = '6f0000000000000000000c01';
const C2 = '6f0000000000000000000c02';

const skillDoc = (over = {}) => validateSkill({
    key: 'brief.parse',
    name: 'Intake (data)',
    inputs: ['brief'],
    gather: [{ reader: 'task' }],
    prompt: { partials: ['json_only'], instructions: 'Break the brief down.', template: '{{input.brief}} {{gather.task.title}}', output: '{"summary":"..."}' },
    emit: [{ action: 'task.comment', params: { body: '{{answer.summary}}' } }],
    ...over,
}).value;

const req = (over = {}) => ({ headers: { companyid: C }, uid: 'u1', params: {}, query: {}, body: {}, ...over });
const res = () => { const r = { code: 200 }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
const call = async (fn, request) => { const r = res(); await fn(request, r); return r; };

beforeEach(() => {
    Object.keys(mockDb.store).forEach((k) => { mockDb.store[k].length = 0; });
    mockDb.calls.length = 0;
    jest.clearAllMocks();
    getRoleType.mockResolvedValue(1);
});

describe('the collection is declared', () => {
    it('has a unique index on key and is registered under SCHEMA_TYPE and dbCollections', () => {
        expect(SCHEMA_TYPE.AGENT_SKILLS).toBe('agent_skills');
        expect(dbCollections.AGENT_SKILLS).toBe('agent_skills');
        expect(agentSkillsSchema.indexes().some(([fields, opts]) => fields.key === 1 && opts && opts.unique)).toBe(true);
        ['key', 'name', 'version', 'enabled', 'inputs', 'gather', 'prompt', 'emit', 'emits', 'risk', 'retiredAt', 'createdBy'].forEach((f) => expect(agentSkillsSchema.path(f)).toBeTruthy());
    });
});

describe('the hybrid resolver', () => {
    it('resolves a code skill when the company has no data skill', async () => {
        const skill = await skillRecord.getSkill(C, 'brief.parse');
        expect(skill).toBe(codeSkills.getSkill('brief.parse'));
        expect(await skillRecord.getSkill(C, 'nope')).toBeNull();
    });

    it('a company data skill shadows the code skill of the same key', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillDoc());
        const skill = await skillRecord.getSkill(C, 'brief.parse');
        expect(skill.source).toBe('data');
        expect(skill.name).toBe('Intake (data)');
        expect(skill.kind).toBe('generic');
        expect(skill.systemPrompt).toContain('Return ONLY JSON');
        expect(skill.systemPrompt).toContain('Break the brief down.');
    });

    it('a disabled or retired data skill does not shadow: the code skill runs', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillDoc({ enabled: false }));
        expect((await skillRecord.getSkill(C, 'brief.parse')).source).toBeUndefined();
        mockDb.store[SCHEMA_TYPE.AGENT_SKILLS].length = 0;
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, { ...skillDoc(), retiredAt: new Date() });
        expect((await skillRecord.getSkill(C, 'brief.parse'))).toBe(codeSkills.getSkill('brief.parse'));
    });

    it('reads the data skill from the company database, never another', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillDoc({ key: 'only.here', name: 'Mine' }));
        await skillRecord.getSkill(C2, 'only.here');
        expect(mockDb.calls.map((c) => c.companyId)).toEqual([C2]);
    });

    it('listSkills merges both sources and hides a code skill behind a live data skill', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillDoc());
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillDoc({ key: 'task.summary', name: 'Summariser', enabled: false }));
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, { ...skillDoc({ key: 'old.one', name: 'Old' }), retiredAt: new Date() });
        const list = await skillRecord.listSkills(C);
        const byKey = Object.fromEntries(list.map((s) => [s.key, s]));
        expect(byKey['brief.parse']).toMatchObject({ source: 'data', enabled: true, inputs: ['brief'], emits: ['task.comment'], risk: 'low', version: 1 });
        expect(byKey['task.summary']).toMatchObject({ source: 'data', enabled: false });
        expect(byKey['old.one']).toBeUndefined();
        expect(byKey['qa-review']).toMatchObject({ source: 'code', enabled: true, inputs: ['public_url'], emits: ['subtask.create', 'task.comment'], risk: 'low' });
        expect(list.filter((s) => s.key === 'brief.parse')).toHaveLength(1);
        expect(list.map((s) => s.key)).toEqual(['brief.parse', 'task.summary', 'qa-review', 'pr.summary', 'digest.ceo', 'project.guide']);
        expect((await skillRecord.listSkills(C, { includeRetired: true })).some((s) => s.key === 'old.one')).toBe(true);
    });

    it('a data skill narrows the effective actions to the agent’s allowed set and the registry', () => {
        expect(skillRecord.effectiveActions(['task.comment', 'subtask.create'], { allowedActions: ['task.comment'] })).toEqual(['task.comment']);
        expect(skillRecord.effectiveActions(['task.comment', 'subtask.create'], { allowedActions: [] })).toEqual(['task.comment', 'subtask.create']);
        expect(skillRecord.effectiveActions(['task.delete', 'task.comment', 'nope'], null)).toEqual(['task.comment']);
    });
});

describe('which skill a run executes honours enabled: false', () => {
    it('skips a disabled first skill and takes the next enabled one', () => {
        expect(skillSlugOf({ skills: [{ key: 'brief.parse', enabled: false }, { key: 'digest.ceo' }] })).toBe('digest.ceo');
        expect(skillSlugOf({ skills: [{ key: 'brief.parse', enabled: false }] })).toBe('qa-review');
        expect(skillSlugOf({ skills: [{ key: 'brief.parse', enabled: false }] }, 'pr.summary')).toBe('pr.summary');
    });
});

describe('the record: create, update, retire', () => {
    it('writes a validated document with version 1 from the first write', async () => {
        const saved = await skillRecord.createSkill(C, skillDoc({ key: 'task.summary', name: 'Summariser' }), { createdBy: 'u1' });
        expect(saved).toMatchObject({ key: 'task.summary', version: 1, enabled: true, createdBy: 'u1', emits: ['task.comment'] });
        expect(mockDb.store[SCHEMA_TYPE.AGENT_SKILLS]).toHaveLength(1);
    });

    it('refuses a duplicate key and an invalid document with field errors', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillDoc());
        await expect(skillRecord.createSkill(C, skillDoc())).rejects.toMatchObject({ status: 400, errors: [{ field: 'key', code: 'duplicate' }] });
        await expect(skillRecord.createSkill(C, { key: 'x.y' })).rejects.toMatchObject({ status: 400, errors: expect.arrayContaining([expect.objectContaining({ field: 'name', code: 'required' })]) });
    });

    it('updates through the validator, keeping the key, and retires instead of deleting', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillDoc());
        const updated = await skillRecord.updateSkill(C, 'brief.parse', { name: 'Renamed', key: 'other.key' });
        expect(updated).toMatchObject({ key: 'brief.parse', name: 'Renamed' });
        await expect(skillRecord.updateSkill(C, 'brief.parse', { emit: [{ action: 'task.delete', params: {} }] })).rejects.toMatchObject({ errors: [expect.objectContaining({ code: 'never_listed' })] });
        const retired = await skillRecord.retireSkill(C, 'brief.parse');
        expect(retired.enabled).toBe(false);
        expect(retired.retiredAt).toBeInstanceOf(Date);
        expect(mockDb.store[SCHEMA_TYPE.AGENT_SKILLS]).toHaveLength(1);
        expect(await skillRecord.updateSkill(C, 'missing', {})).toBeNull();
    });
});

describe('GET /api/v2/agents/skills and the write endpoints', () => {
    it('serves the manifest to any member of the company', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillDoc());
        getRoleType.mockResolvedValue(3);
        const r = await call(ctrl.listSkills, req());
        expect(r.body.status).toBe(true);
        expect(r.body.data.map((s) => s.key)).toContain('brief.parse');
        r.body.data.forEach((s) => expect(Object.keys(s)).toEqual(expect.arrayContaining(['key', 'name', 'source', 'inputs', 'emits', 'risk', 'enabled'])));
    });

    it('serves the frozen catalogues for the editor', async () => {
        const r = await call(ctrl.getCatalogues, req());
        expect(r.body.status).toBe(true);
        expect(Object.keys(r.body.data)).toEqual(expect.arrayContaining(['inputs', 'readers', 'partials', 'actions', 'taskFields']));
    });

    it('refuses without a valid companyid header', async () => {
        const r = await call(ctrl.listSkills, req({ headers: {} }));
        expect(r.code).toBe(403);
        expect(r.body.status).toBe(false);
    });

    it('creates for an owner, returns field-level errors in data.errors, and refuses a member or an agent token', async () => {
        const created = await call(ctrl.createSkill, req({ body: skillDoc({ key: 'task.summary', name: 'Summariser' }) }));
        expect(created.code).toBe(201);
        expect(created.body.data).toMatchObject({ key: 'task.summary', createdBy: 'u1' });

        const bad = await call(ctrl.createSkill, req({ body: { key: 'task.summary', name: 'Dup', prompt: {}, emit: [{ action: 'task.delete' }] } }));
        expect(bad.code).toBe(400);
        expect(bad.body).toMatchObject({ status: false, data: { errors: expect.arrayContaining([expect.objectContaining({ field: 'emit[0].action', code: 'never_listed' })]) } });

        getRoleType.mockResolvedValue(3);
        expect((await call(ctrl.createSkill, req({ body: skillDoc({ key: 'a.b' }) }))).code).toBe(403);
        getRoleType.mockResolvedValue(1);
        expect((await call(ctrl.createSkill, req({ agent: true, body: skillDoc({ key: 'a.b' }) }))).code).toBe(403);
    });

    it('updates and retires by key, 404 when the key is unknown', async () => {
        mockDb.seed(SCHEMA_TYPE.AGENT_SKILLS, skillDoc());
        const updated = await call(ctrl.updateSkill, req({ params: { key: 'brief.parse' }, body: { enabled: false } }));
        expect(updated.body.data.enabled).toBe(false);
        expect((await call(ctrl.getSkill, req({ params: { key: 'brief.parse' } }))).body.data.name).toBe('Intake (data)');
        const retired = await call(ctrl.retireSkill, req({ params: { key: 'brief.parse' } }));
        expect(retired.body.data.retiredAt).toBeTruthy();
        expect((await call(ctrl.updateSkill, req({ params: { key: 'nope' }, body: {} }))).code).toBe(404);
        expect((await call(ctrl.retireSkill, req({ params: { key: 'nope' } }))).code).toBe(404);
        expect((await call(ctrl.getSkill, req({ params: { key: 'nope' } }))).code).toBe(404);
    });
});
