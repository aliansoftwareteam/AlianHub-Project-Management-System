jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn() }));
const { skillSlugOf } = require('../Modules/Agents/runs');

describe('which skill a run executes', () => {
    it('takes the explicit slug first', () => {
        expect(skillSlugOf({ skills: [{ key: 'brief.parse' }] }, 'qa-review')).toBe('qa-review');
    });
    it('reads the key off a stored skill object instead of stringifying it', () => {
        expect(skillSlugOf({ skills: [{ key: 'brief.parse', name: 'brief.parse' }] })).toBe('brief.parse');
        expect(skillSlugOf({ skills: [{ key: 'x' }] })).not.toBe('[object Object]');
    });
    it('accepts legacy string skills and falls back to the QA review', () => {
        expect(skillSlugOf({ skills: ['pr.summary'] })).toBe('pr.summary');
        expect(skillSlugOf({ skills: [] })).toBe('qa-review');
        expect(skillSlugOf(null)).toBe('qa-review');
    });
});

describe('skills as stored by the API', () => {
    jest.mock('../Modules/Agents/runs', () => ({ getAgent: jest.fn(), canStart: jest.fn(), create: jest.fn(), skillSlugOf: jest.fn() }));
    const { normaliseSkill } = require('../Modules/Agents/controller');
    it('keeps the key and name of a skill object instead of stringifying it', () => {
        expect(normaliseSkill({ key: 'brief.parse', name: 'brief.parse', actions: ['task.comment'], enabled: true }))
            .toEqual({ key: 'brief.parse', name: 'brief.parse', enabled: true, actions: ['task.comment'] });
    });
    it('accepts a bare string and drops junk', () => {
        expect(normaliseSkill('pr.summary')).toEqual({ key: 'pr.summary', name: 'pr.summary', enabled: true });
        expect(normaliseSkill({})).toBeNull();
        expect(normaliseSkill(null)).toBeNull();
    });
});
