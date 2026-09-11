const dns = require('dns');

const mockDb = require('./fixtures/fakeMongo').create();
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: (...a) => mockDb.crud(...a) }));
jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
jest.mock('../Modules/Webhooks/dispatcher', () => ({ invalidateCompanyCache: jest.fn() }));

const { SCHEMA_TYPE } = require('../Config/schemaType');
const { isValidUrl, validateWebhookInput } = require('../Modules/Webhooks/helpers/webhookRules');
const ctrl = require('../Modules/Webhooks/controller');

const COMPANY = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OWNER = '300000000000000000000001';
const T = SCHEMA_TYPE.WEBHOOKS;

const res = () => {
    const r = { code: 200, body: null };
    r.status = (c) => { r.code = c; return r; };
    r.json = (b) => { r.body = b; return r; };
    r.send = r.json;
    return r;
};
const call = async (handler, { body = {}, params = {} } = {}) => {
    const r = res();
    await handler({ headers: { companyid: COMPANY }, uid: OWNER, body, params, query: {} }, r);
    return r;
};

describe('REP-04 webhook url validation refuses private hosts', () => {
    it('refuses loopback, link-local, private and internal literals', () => {
        ['http://127.0.0.1:9/int-sink', 'http://169.254.169.254/latest/meta-data', 'http://localhost/hook',
         'http://10.0.0.5/hook', 'http://[::1]/hook', 'http://2130706433/hook', 'https://db.internal/hook'].forEach((url) => {
            expect([url, isValidUrl(url)]).toEqual([url, false]);
            expect(validateWebhookInput({ name: 'x', url, events: ['*'] }).valid).toBe(false);
        });
    });

    it('still accepts public http and https urls', () => {
        expect(isValidUrl('https://hooks.slack.com/services/T/B/X')).toBe(true);
        expect(isValidUrl('http://x.dev/hook')).toBe(true);
    });

    describe('at save time the hostname is resolved', () => {
        let lookup;
        beforeEach(() => {
            mockDb.store[T] = [];
            lookup = jest.spyOn(dns.promises, 'lookup');
        });
        afterEach(() => lookup.mockRestore());

        it('refuses a public-looking name that resolves to a private address', async () => {
            lookup.mockResolvedValue([{ address: '169.254.169.254', family: 4 }]);
            const r = await call(ctrl.createWebhook, { body: { name: 'x', url: 'https://metadata.example.com/latest', events: ['*'] } });
            expect(r.body.status).toBe(false);
            expect(mockDb.store[T]).toHaveLength(0);
        });

        it('refuses an update that points an existing webhook at a private address', async () => {
            const hook = mockDb.seed(T, { name: 'ok', url: 'https://hooks.example.com/a', events: ['*'], secret: 's', active: true, createdBy: OWNER });
            lookup.mockResolvedValue([{ address: '10.1.2.3', family: 4 }]);
            const r = await call(ctrl.updateWebhook, { params: { id: hook._id }, body: { url: 'https://rebind.example.com/a' } });
            expect(r.body.status).toBe(false);
            expect(mockDb.store[T][0].url).toBe('https://hooks.example.com/a');
        });

        it('creates a webhook whose host resolves publicly', async () => {
            lookup.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);
            const r = await call(ctrl.createWebhook, { body: { name: 'Slack', url: 'https://hooks.example.com/a', events: ['task.created'] } });
            expect(r.body.status).toBe(true);
            expect(mockDb.store[T]).toHaveLength(1);
        });
    });
});
