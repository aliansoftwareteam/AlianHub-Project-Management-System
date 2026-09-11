jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));

const registry = require('../Modules/Agents/registry');
const { ALL } = require('../Modules/Agents/skills');
const C = require('../Modules/Agents/skills/catalogues');

const DATA_EXPRESSIBLE = ['brief.parse', 'digest.ceo', 'project.guide'];
const EVIDENCE_LAYER = ['qa-review', 'pr.summary'];

describe('the skill vocabulary is closed', () => {
    it('every catalogue is frozen', () => {
        [C.INPUT_CATALOGUE, C.READER_CATALOGUE, C.PROMPT_PARTIALS, C.EMIT_ACTIONS, C.EMIT_REQUIRED, C.TASK_FIELDS, C.FILTERS].forEach((c) => expect(Object.isFrozen(c)).toBe(true));
        Object.values(C.FILTERS).forEach((f) => { expect(Object.isFrozen(f)).toBe(true); expect(Object.isFrozen(f.args)).toBe(true); });
        expect(() => { C.EMIT_ACTIONS.push('task.delete'); }).toThrow();
    });

    it('emitted actions are exactly the writes of the registry, and never a never-listed key', () => {
        expect([...C.EMIT_ACTIONS].sort()).toEqual(registry.ACTIONS.filter((a) => a.write).map((a) => a.key).sort());
        C.EMIT_ACTIONS.forEach((key) => { expect(registry.has(key)).toBe(true); expect(registry.isNever(key)).toBe(false); });
        expect(C.EMIT_ACTIONS).not.toContain('task.get');
        expect(Object.keys(C.EMIT_REQUIRED).sort()).toEqual([...C.EMIT_ACTIONS].sort());
    });

    it('every code skill declares inputs, reads and emits', () => {
        ALL.forEach((s) => {
            expect(Array.isArray(s.inputs) && s.inputs.length).toBeTruthy();
            expect(Array.isArray(s.reads) && s.reads.length).toBeTruthy();
            expect(Array.isArray(s.emits) && s.emits.length).toBeTruthy();
        });
    });

    it('every code skill input is an input kind, and every emitted action is in the emit set', () => {
        ALL.forEach((s) => {
            s.inputs.forEach((i) => expect(Object.keys(C.INPUT_CATALOGUE)).toContain(i));
            s.emits.forEach((a) => expect(C.EMIT_ACTIONS).toContain(a));
        });
    });

    it('the skills ADR 003 re-expresses as data read only through catalogue readers', () => {
        ALL.filter((s) => DATA_EXPRESSIBLE.includes(s.slug)).forEach((s) => {
            s.reads.forEach((r) => expect(Object.keys(C.READER_CATALOGUE)).toContain(r));
        });
    });

    it('the skills that keep an evidence layer read something the vocabulary does not carry', () => {
        expect(ALL.filter((s) => EVIDENCE_LAYER.includes(s.slug)).map((s) => s.slug).sort()).toEqual([...EVIDENCE_LAYER].sort());
        ALL.filter((s) => EVIDENCE_LAYER.includes(s.slug)).forEach((s) => {
            expect(s.reads.some((r) => !C.READER_CATALOGUE[r])).toBe(true);
        });
    });

    it('the input kinds match what the frontend pickers require of a task', () => {
        expect(Object.keys(C.INPUT_CATALOGUE).sort()).toEqual(['brief', 'linked_doc', 'pr_link', 'project_task', 'public_url']);
    });

    it('the manifest of catalogues is serialisable and complete', () => {
        const m = C.catalogues();
        expect(JSON.parse(JSON.stringify(m))).toEqual(m);
        expect(m.inputs.map((i) => i.key)).toEqual(Object.keys(C.INPUT_CATALOGUE));
        expect(m.readers.map((r) => r.key)).toEqual(Object.keys(C.READER_CATALOGUE));
        expect(m.partials.map((p) => p.key)).toEqual(Object.keys(C.PROMPT_PARTIALS));
        expect(m.actions.map((a) => a.key)).toEqual([...C.EMIT_ACTIONS]);
        expect(m.filters.map((f) => f.key)).toEqual(Object.keys(C.FILTERS));
        m.filters.forEach((f) => expect(f.apply).toBeUndefined());
        expect(m.version).toBe(C.SKILL_VERSION);
    });

    it('input values derive from the task the way taskInputs does', () => {
        const task = { description: '<p>' + 'x'.repeat(50) + '</p>', ProjectID: 'p1', links: [{ kind: 'doc', url: 'http://localhost:4000/pages/1' }], TaskName: 'See https://example.com/page and https://github.com/o/r/pull/3' };
        expect(C.INPUT_CATALOGUE.brief.value(task)).toHaveLength(50);
        expect(C.INPUT_CATALOGUE.brief.value({ description: 'short' })).toBeNull();
        expect(C.INPUT_CATALOGUE.brief.missing({ description: 'short' })).toMatch(/5 characters/);
        expect(C.INPUT_CATALOGUE.public_url.value(task)).toBe('https://example.com/page');
        expect(C.INPUT_CATALOGUE.pr_link.value(task)).toBe('https://github.com/o/r/pull/3');
        expect(C.INPUT_CATALOGUE.project_task.value(task)).toBe('p1');
        expect(C.INPUT_CATALOGUE.linked_doc.value(task)).toBe('http://localhost:4000/pages/1');
        expect(C.INPUT_CATALOGUE.linked_doc.value({})).toBeNull();
    });
});
