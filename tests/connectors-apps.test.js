jest.mock('../Config/loggerConfig', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));

jest.mock('../utils/mongo-handler/mongoQueries', () => {
    const apps = [];
    const connections = [];
    let seq = 1;
    const collOf = (type) => (type === 'connector_apps' ? apps : connections);
    const valueAt = (doc, key) => key.split('.').reduce((o, part) => (o == null ? o : o[part]), doc);
    const matches = (doc, filter) => Object.entries(filter).every(([key, want]) => {
        const have = valueAt(doc, key);
        if (want && typeof want === 'object' && '$ne' in want) return have !== want.$ne;
        return have === want;
    });
    const MongoDbCrudOpration = jest.fn(async (companyId, { type, data }, method) => {
        const coll = collOf(type);
        if (method === 'save') {
            if (MongoDbCrudOpration.__failSave) { const e = MongoDbCrudOpration.__failSave; MongoDbCrudOpration.__failSave = null; throw e; }
            const saved = { _id: `id_${seq++}`, ...data };
            coll.push(saved);
            return saved;
        }
        const [filter = {}, change = {}] = Array.isArray(data) ? data : [data];
        if (method === 'findOne') return coll.find((d) => matches(d, filter)) || null;
        if (method === 'find') return coll.filter((d) => matches(d, filter));
        if (method === 'updateOne') {
            const doc = coll.find((d) => matches(d, filter));
            if (doc) {
                Object.assign(doc, change.$set || {});
                Object.keys(change.$unset || {}).forEach((k) => delete doc[k]);
            }
            return { modifiedCount: doc ? 1 : 0 };
        }
        if (method === 'updateMany') {
            const hit = coll.filter((d) => matches(d, filter));
            hit.forEach((d) => Object.assign(d, change.$set || {}));
            return { modifiedCount: hit.length };
        }
        if (method === 'deleteOne') {
            const i = coll.findIndex((d) => matches(d, filter));
            if (i >= 0) coll.splice(i, 1);
            return { deletedCount: i >= 0 ? 1 : 0 };
        }
        return null;
    });
    MongoDbCrudOpration.__apps = apps;
    MongoDbCrudOpration.__connections = connections;
    MongoDbCrudOpration.__failSave = null;
    MongoDbCrudOpration.__reset = () => { apps.length = 0; connections.length = 0; seq = 1; MongoDbCrudOpration.__failSave = null; };
    return { MongoDbCrudOpration };
});

jest.mock('../Config/secrets', () => {
    const handles = new Map();
    let seq = 1;
    return {
        MAX_VALUE_LENGTH: 8192,
        create: jest.fn(async ({ value }) => { const handle = `sec_${seq++}`; handles.set(handle, value); return { handle }; }),
        rotate: jest.fn(async ({ handle, value }) => { handles.set(handle, value); return { handle }; }),
        resolve: jest.fn(async ({ handle }) => (handles.has(handle) ? handles.get(handle) : null)),
        retire: jest.fn(async ({ handle }) => { handles.delete(handle); return 'revoked'; }),
        __handles: handles,
        __reset: () => { handles.clear(); seq = 1; },
    };
});

jest.mock('../Modules/Audit/recorder', () => ({ recordAudit: jest.fn() }));

const { MongoDbCrudOpration } = require('../utils/mongo-handler/mongoQueries');
const secrets = require('../Config/secrets');
const { recordAudit } = require('../Modules/Audit/recorder');
const apps = require('../Modules/Connectors/apps');

const COMPANY = 'c1';
const ACTOR = { id: 'u1', name: 'Pat', ip: '10.0.0.1' };
const GOOGLE_ENV = ['CONNECTOR_GOOGLE_CLIENT_ID', 'CONNECTOR_GOOGLE_CLIENT_SECRET'];

const clearGoogleEnv = () => GOOGLE_ENV.forEach((k) => delete process.env[k]);

beforeEach(() => {
    MongoDbCrudOpration.__reset();
    secrets.__reset();
    [secrets.create, secrets.rotate, secrets.resolve, secrets.retire, recordAudit].forEach((fn) => fn.mockClear());
    clearGoogleEnv();
});

describe('instance default app (FR-4)', () => {
    it('reads CONNECTOR_<PROVIDER>_CLIENT_* and needs both halves', () => {
        expect(apps.instanceApp('google')).toBeNull();
        process.env.CONNECTOR_GOOGLE_CLIENT_ID = 'cid';
        expect(apps.instanceApp('google')).toBeNull();
        process.env.CONNECTOR_GOOGLE_CLIENT_SECRET = 'csecret';
        expect(apps.instanceApp('google')).toEqual({ source: 'instance', appId: null, clientId: 'cid', clientSecret: 'csecret' });
    });
});

describe('validation', () => {
    it('refuses an unknown provider and missing fields', () => {
        expect(apps.appProblems({ provider: 'nope', clientId: '', clientSecret: '' }))
            .toEqual(expect.arrayContaining(['unknown provider nope', 'clientId is required', 'clientSecret is required']));
        expect(apps.appProblems({ provider: 'google', clientId: 'x', clientSecret: 'y', extra: { k: 1 } }))
            .toEqual(['each extra value is a string of at most 400 characters']);
        expect(apps.appProblems({ provider: 'google', clientId: 'x', clientSecret: 'y' })).toEqual([]);
    });
});

describe('setApp', () => {
    it('stores the secret by handle, keeps it off the row, and audits (FR-5)', async () => {
        const out = await apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid', clientSecret: 'shh', actor: ACTOR });
        expect(out).toEqual({ provider: 'google', op: 'set' });
        expect(secrets.create).toHaveBeenCalledTimes(1);
        const saved = MongoDbCrudOpration.__apps[0];
        expect(saved.clientId).toBe('cid');
        expect(saved.secretHandle).toBe('sec_1');
        expect(JSON.stringify(saved)).not.toContain('shh');
        expect(recordAudit).toHaveBeenCalledWith(COMPANY, expect.objectContaining({ action: 'connector.app_set', entityId: 'google' }));
    });

    it('replaces by rotating the same handle, not creating a second secret', async () => {
        await apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid', clientSecret: 'one', actor: ACTOR });
        const out = await apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid2', clientSecret: 'two', actor: ACTOR });
        expect(out.op).toBe('replace');
        expect(secrets.create).toHaveBeenCalledTimes(1);
        expect(secrets.rotate).toHaveBeenCalledTimes(1);
        expect(MongoDbCrudOpration.__apps).toHaveLength(1);
        expect(MongoDbCrudOpration.__apps[0].clientId).toBe('cid2');
    });

    it('refuses invalid input before touching the store', async () => {
        await expect(apps.setApp({ companyId: COMPANY, provider: 'google', clientId: '', clientSecret: 'x', actor: ACTOR }))
            .rejects.toMatchObject({ name: 'AppError', code: 'invalid_app' });
        expect(secrets.create).not.toHaveBeenCalled();
    });

    it('clears a previously set extra when a replace omits it', async () => {
        await apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid', clientSecret: 'one', extra: { apiKey: 'k' }, actor: ACTOR });
        expect(MongoDbCrudOpration.__apps[0].extra).toEqual({ apiKey: 'k' });
        await apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid', clientSecret: 'two', actor: ACTOR });
        expect(MongoDbCrudOpration.__apps[0]).not.toHaveProperty('extra');
    });

    it('retires the just-created secret when the row write fails', async () => {
        MongoDbCrudOpration.__failSave = new Error('db exploded');
        await expect(apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid', clientSecret: 'shh', actor: ACTOR }))
            .rejects.toThrow('db exploded');
        expect(secrets.create).toHaveBeenCalledTimes(1);
        expect(secrets.retire).toHaveBeenCalledWith(expect.objectContaining({ handle: 'sec_1' }));
        expect(MongoDbCrudOpration.__apps).toHaveLength(0);
    });

    it('reports a racing duplicate as a conflict and leaves no orphan secret', async () => {
        MongoDbCrudOpration.__failSave = Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        await expect(apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid', clientSecret: 'shh', actor: ACTOR }))
            .rejects.toMatchObject({ name: 'AppError', code: 'app_conflict', statusCode: 409 });
        expect(secrets.retire).toHaveBeenCalledWith(expect.objectContaining({ handle: 'sec_1' }));
    });
});

describe('resolveApp (FR-5)', () => {
    it('prefers the company app and yields its secret', async () => {
        process.env.CONNECTOR_GOOGLE_CLIENT_ID = 'inst';
        process.env.CONNECTOR_GOOGLE_CLIENT_SECRET = 'instsecret';
        await apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid', clientSecret: 'shh', actor: ACTOR });
        const resolved = await apps.resolveApp({ companyId: COMPANY, provider: 'google' });
        expect(resolved).toMatchObject({ source: 'company', clientId: 'cid', clientSecret: 'shh' });
        expect(resolved.appId).toBe(MongoDbCrudOpration.__apps[0]._id);
    });

    it('falls back to the instance default when no company app', async () => {
        process.env.CONNECTOR_GOOGLE_CLIENT_ID = 'inst';
        process.env.CONNECTOR_GOOGLE_CLIENT_SECRET = 'instsecret';
        expect(await apps.resolveApp({ companyId: COMPANY, provider: 'google' }))
            .toEqual({ source: 'instance', appId: null, clientId: 'inst', clientSecret: 'instsecret' });
    });

    it('refuses when neither a company app nor an instance default exists', async () => {
        await expect(apps.resolveApp({ companyId: COMPANY, provider: 'google' }))
            .rejects.toMatchObject({ name: 'AppError', code: 'app_not_found' });
    });

    it('refuses when the stored secret cannot be read', async () => {
        await apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid', clientSecret: 'shh', actor: ACTOR });
        secrets.__handles.clear();
        await expect(apps.resolveApp({ companyId: COMPANY, provider: 'google' }))
            .rejects.toMatchObject({ name: 'AppError', code: 'app_secret_unreadable' });
    });
});

describe('removeApp and reauth (FR-6)', () => {
    it('retires the secret, drops the row, and sends its company connections back to reauth', async () => {
        await apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid', clientSecret: 'shh', actor: ACTOR });
        MongoDbCrudOpration.__connections.push(
            { _id: 'x1', provider: 'google', app: { source: 'company' }, status: 'connected', deletedStatusKey: 0 },
            { _id: 'x2', provider: 'google', app: { source: 'instance' }, status: 'connected', deletedStatusKey: 0 },
        );
        const out = await apps.removeApp({ companyId: COMPANY, provider: 'google', actor: ACTOR });
        expect(out).toEqual({ provider: 'google', op: 'remove' });
        expect(secrets.retire).toHaveBeenCalledTimes(1);
        expect(MongoDbCrudOpration.__apps).toHaveLength(0);
        expect(MongoDbCrudOpration.__connections.find((c) => c._id === 'x1').status).toBe('reauth_required');
        expect(MongoDbCrudOpration.__connections.find((c) => c._id === 'x2').status).toBe('connected');
        expect(recordAudit).toHaveBeenCalledWith(COMPANY, expect.objectContaining({ action: 'connector.app_removed', entityId: 'google' }));
    });

    it('refuses to remove an app that is not set', async () => {
        await expect(apps.removeApp({ companyId: COMPANY, provider: 'google', actor: ACTOR }))
            .rejects.toMatchObject({ name: 'AppError', code: 'app_not_found' });
    });
});

describe('describeApps and companyProviders', () => {
    it('lists apps without any secret, and the providers a workspace has set', async () => {
        await apps.setApp({ companyId: COMPANY, provider: 'google', clientId: 'cid', clientSecret: 'shh', actor: ACTOR });
        const listed = await apps.describeApps(COMPANY);
        expect(listed).toEqual([expect.objectContaining({ provider: 'google', clientId: 'cid' })]);
        expect(JSON.stringify(listed)).not.toContain('sec_');
        expect(JSON.stringify(listed)).not.toContain('shh');
        expect(await apps.companyProviders(COMPANY)).toEqual(['google']);
    });
});
