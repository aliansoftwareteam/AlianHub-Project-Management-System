const mockCrud = jest.fn(async () => []);
jest.mock('../Modules/AICore/llmProvider', () => ({
    getProvider: () => ({ name: 'fake', chat: jest.fn() }),
    isAnyProviderConfigured: () => true,
}));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockCrud(...a) }));
jest.mock('../Modules/settings/ProjectSkills/helper', () => ({ resolveProjectSkills: jest.fn(async () => []), getActiveSkillSlugs: jest.fn(async () => []) }));
jest.mock('../Modules/AIProjectGenerator/orchestrator', () => ({ normalizePlanColors: (p) => p }));
jest.mock('../Modules/AIProjectGenerator/sseEmitter', () => ({ emit: jest.fn(), handleEvents: jest.fn(), COMPLETE_EVENT: 'complete' }));

const ctrl = require('../Modules/AIProjectGenerator/controller');

const C = '6f0000000000000000000c01';
const OTHER_COMPANY = '6f0000000000000000000c02';
const TOO_SHORT = 'A shop';

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.send = (b) => { r.body = b; return r; };
    return r;
};

// Both companies are in the audience, so only the tenant rule can tell them apart.
const call = async (handler, { body = {}, headers = { companyid: C }, aud = [C, OTHER_COMPANY] } = {}) => {
    const r = res();
    await handler({ headers, aud, body: { description: TOO_SHORT, ...body }, uid: '6f0000000000000000000001', params: {} }, r);
    return r;
};

beforeEach(() => mockCrud.mockClear());

describe.each(['plan', 'clarify', 'brief'])('AI project %s takes the company from the verified request', (name) => {
    it('gets past the company check for a normal call', async () => {
        const r = await call(ctrl[name]);

        expect(r.code).toBe(400);
        expect(r.body.statusText).toMatch(/at least 20 characters/);
    });

    it('gets past the company check when the body repeats the header company', async () => {
        const r = await call(ctrl[name], { body: { companyId: C } });

        expect(r.code).toBe(400);
    });

    it('refuses a body companyId naming another company', async () => {
        const r = await call(ctrl[name], { body: { companyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
    });

    it('refuses a body CompanyId naming another company', async () => {
        const r = await call(ctrl[name], { body: { CompanyId: OTHER_COMPANY } });

        expect(r.code).toBe(403);
    });

    it('refuses a header outside the audience even when the body names a company inside it', async () => {
        const r = await call(ctrl[name], { headers: { companyid: '6f0000000000000000000c09' }, body: { companyId: C } });

        expect(r.code).toBe(403);
    });
});
