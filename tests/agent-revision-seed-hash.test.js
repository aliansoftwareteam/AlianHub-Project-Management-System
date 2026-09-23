jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn(async () => null) }));
jest.mock('../Config/loggerConfig', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../Modules/Agents/skillRecord', () => ({ getSkill: jest.fn(async () => null) }));

const revisions = require('../Modules/Agents/revisions');

const FLAGS = ['SKILL_EXTERNAL_READS', 'PR_SUMMARY_AS_DATA'];
const saved = {};
beforeAll(() => FLAGS.forEach((k) => { saved[k] = process.env[k]; }));
afterEach(() => FLAGS.forEach((k) => { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }));

const pinnedHash = async (key) => (await revisions.pinFor('6f0000000000000000000001', null, key)).skillRevision.hash;

describe('the skill revision a run pins', () => {
    it('names the code file when pr.summary runs its code version', async () => {
        FLAGS.forEach((k) => { delete process.env[k]; });
        expect(await pinnedHash('pr.summary')).toBe(revisions.skillRefOf('pr.summary').hash);
    });

    it('names the seed document, not the code file, when pr.summary runs as data', async () => {
        FLAGS.forEach((k) => { process.env[k] = 'on'; });
        const hash = await pinnedHash('pr.summary');
        expect(hash).toMatch(/^[a-f0-9]{16}$/);
        expect(hash).not.toBe(revisions.skillRefOf('pr.summary').hash);
    });

    it('pins the same seed hash under the seed\'s alias', async () => {
        FLAGS.forEach((k) => { process.env[k] = 'on'; });
        expect(await pinnedHash('risk.flags')).toBe(await pinnedHash('pr.summary'));
    });

    it('still names a stored company skill by its version', async () => {
        require('../Modules/Agents/skillRecord').getSkill.mockResolvedValueOnce({ source: 'data', version: 3 });
        expect((await revisions.pinFor('6f0000000000000000000001', null, 'pr.summary')).skillRevision).toEqual({ key: 'pr.summary', hash: null, n: 3 });
    });
});
