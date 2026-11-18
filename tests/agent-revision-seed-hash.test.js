jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Agents/skillRecord', () => ({ getSkill: jest.fn(async () => null) }));

const revisions = require('../Modules/Agents/revisions');

const FLAG = 'SKILL_EXTERNAL_READS';
let saved;
beforeAll(() => { saved = process.env[FLAG]; });
afterEach(() => { if (saved === undefined) delete process.env[FLAG]; else process.env[FLAG] = saved; });

const pinnedHash = async (key) => (await revisions.pinFor('6f0000000000000000000001', null, key)).skillRevision.hash;

describe('the skill revision a run pins for pr.summary', () => {
    it('names the seed document', async () => {
        process.env[FLAG] = 'on';
        expect(await pinnedHash('pr.summary')).toMatch(/^[a-f0-9]{16}$/);
    });

    it('is the same hash whether external reads are on or off', async () => {
        process.env[FLAG] = 'on';
        const on = await pinnedHash('pr.summary');
        process.env[FLAG] = 'off';
        expect(await pinnedHash('pr.summary')).toBe(on);
    });

    it('is the same hash under the seed\'s alias', async () => {
        process.env[FLAG] = 'on';
        expect(await pinnedHash('risk.flags')).toBe(await pinnedHash('pr.summary'));
    });

    it('is the hash an agent revision records for the skill, so the two never disagree', async () => {
        process.env[FLAG] = 'off';
        expect(revisions.skillRefOf('pr.summary').hash).toBe(await pinnedHash('pr.summary'));
        expect(revisions.skillRefsOf({ skills: ['risk.flags'] })[0].hash).toBe(await pinnedHash('pr.summary'));
    });

    it('no code file under skills/ names pr.summary or risk.flags', () => {
        const hashes = revisions.loadSkillHashes();
        expect(hashes.has('pr.summary')).toBe(false);
        expect(hashes.has('risk.flags')).toBe(false);
    });

    it('still names a stored company skill by its version', async () => {
        require('../Modules/Agents/skillRecord').getSkill.mockResolvedValueOnce({ source: 'data', version: 3 });
        expect((await revisions.pinFor('6f0000000000000000000001', null, 'pr.summary')).skillRevision).toEqual({ key: 'pr.summary', hash: null, n: 3 });
    });
});
