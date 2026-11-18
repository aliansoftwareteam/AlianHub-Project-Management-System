const fs = require('fs');
const path = require('path');

const mockDbs = {};
const mockDbFor = (companyId) => { mockDbs[companyId] = mockDbs[companyId] || require('./fixtures/fakeMongo').create(); return mockDbs[companyId]; };

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (companyId, q, method) => mockDbFor(String(companyId)).crud(companyId, q, method) }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const { buildContext, validateMigration, listMigrations } = require('../migrations');
const { SCHEMA_TYPE } = require('../Config/schemaType');
const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const { validateSkill } = require('../Modules/Agents/skills/validateSkill');
const { documentOf, SEEDS } = require('../Modules/Agents/skills/seeds');
const codeSkills = require('../Modules/Agents/skills');
const skillRecord = require('../Modules/Agents/skillRecord');
const { splitFor } = require('../Modules/Agents/taskSplit');
const migration = require('../migrations/022-seed-reporter-and-guide-skills');

const T = SCHEMA_TYPE.AGENT_SKILLS;
const C1 = '6f0000000000000000000c01';
const C2 = '6f0000000000000000000c02';
const logger = { info: jest.fn(), error: jest.fn() };
const contextFor = (companies = [C1, C2]) => buildContext({ MongoDbCrudOpration, SCHEMA_TYPE, logger, listCompanies: async () => companies.map((_id) => ({ _id })) });
const rows = (companyId) => mockDbFor(companyId).store[T] || [];
const agent = (over = {}) => ({ _id: 'a1', name: 'Reporter', skills: [{ key: 'digest.ceo' }], allowedActions: ['task.get', 'task.comment'], paused: false, projectIds: [], ...over });

beforeEach(() => {
    Object.keys(mockDbs).forEach((k) => { delete mockDbs[k]; });
    jest.clearAllMocks();
});

describe('the reporter and the guide are documents, not code', () => {
    it('no longer exist as code skills', () => {
        ['digest.js', 'projectGuide.js'].forEach((file) => {
            expect(fs.existsSync(path.join(__dirname, '..', 'Modules', 'Agents', 'skills', file))).toBe(false);
        });
    });

    it('are compiled from their seed, so every part of them is declared in the vocabulary', () => {
        [['digest.ceo', SEEDS.digest], ['project.guide', SEEDS.projectGuide]].forEach(([key, seed]) => {
            const skill = codeSkills.getSkill(key);
            const doc = documentOf(seed);
            expect(skill.kind).toBe('generic');
            expect(skill.version).toBe(1);
            expect(skill.inputs).toEqual(doc.inputs);
            expect(skill.emits).toEqual(doc.emits);
            expect(skill.reads).toEqual(doc.gather.map((s) => s.reader));
            expect(skill.systemPrompt).toContain('Return ONLY JSON:');
        });
    });

    it('keeps the reporter reachable by the alias an agent may already hold', () => {
        expect(codeSkills.getSkill('risk.today')).toBe(codeSkills.getSkill('digest.ceo'));
    });

    it('resolve for a company that has no row of its own, so a new workspace still has them', async () => {
        for (const key of ['digest.ceo', 'project.guide', 'risk.today']) {
            // eslint-disable-next-line no-await-in-loop
            expect(await skillRecord.getSkill(C1, key)).toBeTruthy();
        }
        expect(rows(C1)).toHaveLength(0);
    });
});

describe('the agent/person split is unchanged by the migration', () => {
    it('still reads agent-after on a report, naming the project it needs', () => {
        expect(splitFor({ task: { TaskName: 'Write the weekly digest' }, agents: [agent()] }))
            .toMatchObject({ label: 'agent-after', skill: 'digest.ceo', need: 'project_task' });
    });

    it('still reads agent-after for the project guide, as step 1 recorded', () => {
        const guide = agent({ skills: [{ key: 'project.guide' }], allowedActions: ['task.get', 'task.comment', 'subtask.create'] });
        expect(splitFor({ task: { TaskName: 'Plan the next stage of the project' }, agents: [guide] }))
            .toMatchObject({ label: 'agent-after', skill: 'project.guide', need: 'project_task' });
    });

    it('never makes either the agent for a single task, however complete that task is', () => {
        const task = { TaskName: 'Write the weekly digest', ProjectID: 'p1', rawDescription: 'a'.repeat(60) };
        expect(splitFor({ task, agents: [agent()] }).label).toBe('agent-after');
    });
});

describe('022-seed-reporter-and-guide-skills', () => {
    it('is a valid company-scoped migration the runner lists after 010', () => {
        expect(() => validateMigration(migration, '022-seed-reporter-and-guide-skills')).not.toThrow();
        expect(migration.scope).toBe('company');
        const ids = listMigrations().map((m) => m.id);
        expect(ids.indexOf('022-seed-reporter-and-guide-skills')).toBeGreaterThan(ids.indexOf('010-seed-brief-parse-skill'));
        expect(ids).toEqual([...ids].sort());
    });

    it('inserts both skills in each company where absent, logs counts, and is idempotent', async () => {
        const first = contextFor();
        await migration.up(first);
        expect(first.companies[C1]).toEqual({ ok: true, inserted: 2, present: 0 });
        expect(first.companies[C2]).toEqual({ ok: true, inserted: 2, present: 0 });
        [C1, C2].forEach((c) => expect(rows(c).map((r) => r.key).sort()).toEqual(['digest.ceo', 'project.guide']));
        expect(mockDbFor(C1).calls.every((call) => call.companyId === C1)).toBe(true);
        expect(logger.info).toHaveBeenCalledWith(`[migrations] 022 ${C1}: {"inserted":2,"present":0}`);

        const snapshot = JSON.stringify([rows(C1), rows(C2)]);
        const again = contextFor();
        await migration.up(again);
        expect(again.companies[C1]).toEqual({ ok: true, inserted: 0, present: 2 });
        expect(JSON.stringify([rows(C1), rows(C2)])).toBe(snapshot);
    });

    it('leaves a company its own copy, even retired', async () => {
        mockDbFor(C1).seed(T, { ...documentOf({ ...SEEDS.digest, name: 'Our reporter' }), enabled: false, retiredAt: new Date(1) });
        const ctx = contextFor();
        await migration.up(ctx);
        expect(ctx.companies[C1]).toEqual({ ok: true, inserted: 1, present: 1 });
        expect(rows(C1).find((r) => r.key === 'digest.ceo')).toMatchObject({ name: 'Our reporter', enabled: false });
    });

    it('writes documents that validate unchanged as stored', async () => {
        await migration.up(contextFor([C1]));
        rows(C1).forEach((row) => {
            const { _id, createdAt, ...stored } = row;
            expect(_id).toBeTruthy();
            expect(validateSkill(stored).errors).toEqual([]);
            expect(stored).toEqual(documentOf(stored.key === 'digest.ceo' ? SEEDS.digest : SEEDS.projectGuide));
        });
    });

    it('lists each skill once after the seed, as data the workspace owns', async () => {
        const before = await skillRecord.listSkills(C1);
        expect(before.filter((s) => s.key === 'digest.ceo')).toEqual([expect.objectContaining({ source: 'code' })]);

        await migration.up(contextFor([C1]));
        const after = await skillRecord.listSkills(C1);
        ['digest.ceo', 'project.guide'].forEach((key) => {
            expect(after.filter((s) => s.key === key)).toEqual([expect.objectContaining({ source: 'data', version: 1, enabled: true, inputs: ['project_task'] })]);
        });
    });

    it('lets an admin edit the copy, and the edit is what then runs', async () => {
        await migration.up(contextFor([C1]));
        await skillRecord.updateSkill(C1, 'digest.ceo', { name: 'Monday report' });
        const skill = await skillRecord.getSkill(C1, 'digest.ceo');
        expect(skill).toMatchObject({ name: 'Monday report', source: 'data' });
        expect(codeSkills.getSkill('digest.ceo').name).toBe('Reporter');
    });
});

describe('the vocabulary the migration needed', () => {
    const base = () => JSON.parse(JSON.stringify(documentOf(SEEDS.digest)));

    it('accepts the reporter’s fallback and ground-truth clause', () => {
        const checked = validateSkill(SEEDS.digest);
        expect(checked.errors).toEqual([]);
        expect(checked.value.fallback).toContain('{{gather.plan.open}}');
        expect(checked.value.grounded).toEqual({ keys: 'gather.plan.keys', numbers: 'gather.plan.counts', fields: ['digest'], mustNameKey: ['lookFirst'], allowHours: [24, 48] });
    });

    it('refuses a fallback that reads the answer the model did not give', () => {
        const { errors } = validateSkill({ ...base(), fallback: '{{answer.digest}}' });
        expect(errors).toEqual([expect.objectContaining({ field: 'fallback', code: 'unknown_placeholder' })]);
    });

    it('refuses a ground-truth clause pointed at a reader the skill does not gather', () => {
        const { errors } = validateSkill({ ...base(), grounded: { keys: 'gather.nowhere.keys', fields: ['digest'] } });
        expect(errors).toEqual([expect.objectContaining({ field: 'grounded.keys', code: 'undeclared_reader' })]);
    });

    it('refuses a ground-truth clause that checks nothing', () => {
        const { errors } = validateSkill({ ...base(), grounded: { keys: 'gather.plan.keys' } });
        expect(errors).toEqual([expect.objectContaining({ field: 'grounded.fields', code: 'required' })]);
    });
});
