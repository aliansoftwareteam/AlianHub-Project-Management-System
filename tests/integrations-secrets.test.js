const mockDb = require('./fixtures/fakeMongo').create();

jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../utils/commonFunctions', () => ({ removeCache: jest.fn() }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const ctrl = require('../Modules/Integrations/controller');
const { isEncrypted } = require('../utils/secretField');

const PLAIN = 'xoxb-plaintext-verification-token';
const res = () => { const r = { body: null }; r.send = (b) => { r.body = b; return r; }; r.json = r.send; r.status = () => r; return r; };
const req = (body, extra = {}) => ({ headers: { companyid: 'c1' }, body, uid: 'u1', params: {}, ...extra });

beforeAll(() => { process.env.JWT_SECRET = 'test-secret'; });

describe('integration secrets at rest', () => {
    test('a saved connection never stores the secret in plaintext, and the API never returns it', async () => {
        const r = res();
        await ctrl.connect(req({ type: 'slack', config: { verification_token: PLAIN, default_channel: '#dev' } }), r);
        expect(r.body.status).toBe(true);
        const raw = mockDb.store[SCHEMA_TYPE.INTEGRATION_CONNECTIONS][0];
        expect(JSON.stringify(raw)).not.toContain(PLAIN);
        expect(isEncrypted(raw.config.verification_token)).toBe(true);
        expect(raw.config.default_channel).toBe('#dev');
        expect(raw.secretsVersion).toBe(1);
        expect(JSON.stringify(r.body)).not.toContain(PLAIN);
        expect(r.body.data.secrets).toEqual({ verification_token: true });
    });

    test('re-connecting a single-instance integration re-encrypts in place', async () => {
        const r = res();
        await ctrl.connect(req({ type: 'slack', config: { verification_token: 'second-token' } }), r);
        const rows = mockDb.store[SCHEMA_TYPE.INTEGRATION_CONNECTIONS];
        expect(rows).toHaveLength(1);
        expect(JSON.stringify(rows[0])).not.toContain('second-token');
        expect(isEncrypted(rows[0].config.verification_token)).toBe(true);
        expect(rows[0].secretsVersion).toBe(1);
        expect(JSON.stringify(r.body)).not.toContain('second-token');
    });

    test('the slack command decrypts at the point of use', async () => {
        const ok = res();
        await ctrl.slackCommand({ params: { companyId: 'c1' }, body: { token: 'second-token', text: 'help' } }, ok);
        expect(ok.body.text).toMatch(/alianhub/i);
        const bad = res();
        await ctrl.slackCommand({ params: { companyId: 'c1' }, body: { token: 'wrong', text: 'help' } }, bad);
        expect(bad.body.text).toMatch(/verification failed/i);
    });

    test('listConnections never exposes secrets', async () => {
        const r = res();
        await ctrl.listConnections(req({}), r);
        expect(JSON.stringify(r.body)).not.toContain('second-token');
        expect(r.body.data[0].config).not.toHaveProperty('verification_token');
    });
});
