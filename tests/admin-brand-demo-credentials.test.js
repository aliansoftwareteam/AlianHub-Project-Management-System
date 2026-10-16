jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() }));
jest.mock('../event/socketEventEmitter', () => ({ emit: jest.fn(), on: jest.fn() }));
jest.mock('../utils/mongo-handler/mongoQueries', () => ({ MongoDbCrudOpration: jest.fn() }));

const { serveModule } = require('./fixtures/workspaceScoping');

const DEMO_KEYS = ['DEMO_MODE', 'DEMO_EMAIL', 'DEMO_PASSWORD'];
const saved = Object.fromEntries(DEMO_KEYS.map((key) => [key, process.env[key]]));
const setDemoEnv = (values) => DEMO_KEYS.forEach((key) => {
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
});

let app;
beforeAll(async () => { app = await serveModule((server) => require('../Modules/Admin/admin').init(server)); });
afterAll(() => app.close());
afterEach(() => setDemoEnv(saved));

const brandSettings = async () => {
    const res = await app.call('GET', '/api/v1/getBrandSettingsData');
    expect(res.status).toBe(200);
    return res.body;
};

/* The login page fills in, and signs into, the demo account from these keys, so they must only leave the server on a demo instance. */
describe('demo credentials in the public brand settings', () => {
    it('are sent with demoMode when DEMO_MODE is "true"', async () => {
        setDemoEnv({ DEMO_MODE: 'true', DEMO_EMAIL: 'demo@alianhub.test', DEMO_PASSWORD: 'Demo-Passw0rd!' });

        expect(await brandSettings()).toEqual(expect.objectContaining({ demoMode: true, demoEmail: 'demo@alianhub.test', demoPassword: 'Demo-Passw0rd!' }));
    });

    it('are sent as empty strings when DEMO_MODE is "true" but they are unset', async () => {
        setDemoEnv({ DEMO_MODE: 'true' });

        expect(await brandSettings()).toEqual(expect.objectContaining({ demoMode: true, demoEmail: '', demoPassword: '' }));
    });

    it.each([
        ['"false"', 'false'],
        ['unset', undefined],
        ['"TRUE"', 'TRUE'],
        ['"1"', '1'],
    ])('are never sent when DEMO_MODE is %s', async (_, mode) => {
        setDemoEnv({ DEMO_MODE: mode, DEMO_EMAIL: 'demo@alianhub.test', DEMO_PASSWORD: 'Demo-Passw0rd!' });

        const body = await brandSettings();
        expect(body.demoMode).toBe(false);
        expect(body).not.toHaveProperty('demoEmail');
        expect(body).not.toHaveProperty('demoPassword');
    });
});
