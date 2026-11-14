require('./fixtures/mcpFlagsOff');

/* 076 — the Drive/Dropbox attachment picker on the connectors module: the Dropbox provider, the pure picker
 * metadata, the bearer-vs-form revoke branch, and the owner-only picker controller (no route reaches another
 * person's account). */

const mockProviderCalls = [];

jest.mock('../Modules/Agents/engine/agentFetch', () => ({
    callProvider: jest.fn(async (url, opts) => { mockProviderCalls.push({ url, opts }); return { status: 200, headers: {}, body: '{}' }; }),
    callApi: jest.fn(),
}));
jest.mock('../Config/tenant', () => {
    class TenantError extends Error { constructor(m) { super(m); this.name = 'TenantError'; this.statusCode = 400; } }
    return { TenantError, tenantOf: (req) => { if (!req.companyId) throw new TenantError('no tenant'); return req.companyId; } };
});
jest.mock('../Config/permissionGuard', () => ({ getRoleType: jest.fn(async (c, uid) => (uid === 'guest' ? 'ROLE_GUEST' : 3)) }));
jest.mock('../Config/roleTypes', () => ({ ROLE_GUEST: 'ROLE_GUEST' }));
jest.mock('../utils/requestAddress', () => ({ requestAddress: () => '1.2.3.4' }));
jest.mock('../Modules/storage/changeScope', () => ({ UPLOAD: 'upload', changeVerdict: jest.fn(async () => ({ allowed: true })) }));
jest.mock('../Modules/storage/wasabi/controller', () => ({ uploadFileWasabiPromise: jest.fn(async () => 'ok/file.txt') }));
jest.mock('../Modules/Connectors/apps', () => ({ resolveApp: jest.fn() }));
jest.mock('../Modules/Connectors/resolveConnection', () => ({ resolveConnection: jest.fn() }));
jest.mock('axios', () => jest.fn());

describe('dropbox provider definition', () => {
    const { validate } = require('../Modules/Connectors/validate');
    const dropbox = require('../Modules/Connectors/providers/dropbox');

    it('passes the registry validation and declares the files product', () => {
        expect(validate(dropbox)).toEqual([]);
        expect(dropbox.id).toBe('dropbox');
        expect(dropbox.products.files).toContain('files.content.read');
        expect(dropbox.auth.revokeAuth).toBe('bearer');
    });

    it('reads the account id from the token response and refuses one without it', () => {
        expect(dropbox.readAccount({ tokenResponse: { account_id: 'dbid:abc' } })).toEqual({ id: 'dbid:abc', label: '' });
        expect(() => dropbox.readAccount({ tokenResponse: {} })).toThrow(/account_id/);
    });
});

describe('pickerProviders (pure)', () => {
    const P = require('../Modules/Connectors/pickerProviders');

    it('maps the stable attachment source to its module provider', () => {
        expect(P.bySource('google_drive')).toMatchObject({ provider: 'google', product: 'drive', needsToken: true });
        expect(P.bySource('dropbox')).toMatchObject({ provider: 'dropbox', needsToken: false });
        expect(P.bySource('nope')).toBeNull();
    });

    it('builds the download request per provider', () => {
        expect(P.downloadRequestFor('google_drive', 'fid').url).toContain('/drive/v3/files/fid?alt=media');
        const dbx = P.downloadRequestFor('dropbox', 'id:xyz');
        expect(dbx.method).toBe('post');
        expect(JSON.parse(dbx.headers['Dropbox-API-Arg']).path).toBe('id:xyz');
    });

    it('offers a thumbnail request for Drive only', () => {
        expect(P.thumbnailRequestFor('google_drive', 'fid')).toBeTruthy();
        expect(P.thumbnailRequestFor('dropbox', 'fid')).toBeNull();
    });

    it('only accepts genuine Dropbox content URLs (SSRF guard)', () => {
        expect(P.isDropboxContentUrl('https://uc123.dl.dropboxusercontent.com/x')).toBe(true);
        expect(P.isDropboxContentUrl('https://dl.dropboxusercontent.com@evil.com/x')).toBe(false);
        expect(P.isDropboxContentUrl('http://dl.dropboxusercontent.com/x')).toBe(false);
        expect(P.isDropboxContentUrl('https://evil.com/x')).toBe(false);
    });

    it.each([
        'https://dl.dropboxusercontent.com/s/abc/file.pdf',
        'https://www.dropbox.com/s/abc/file.pdf?dl=1',
        'https://DL.DROPBOXUSERCONTENT.COM/x',
    ])('accepts the Dropbox content URL %s', (url) => {
        expect(P.isDropboxContentUrl(url)).toBe(true);
    });

    it.each([
        'file:///etc/passwd',
        'https://169.254.169.254/latest/meta-data',
        'https://evil.test/dropbox.com',
        'https://user:pw@dl.dropboxusercontent.com/x',
        'https://notdropbox.com/x',
        'https://dl.dropboxusercontent.com.evil.test/x',
        'https://dl.dropboxusercontent.com/a b',
        '',
        null,
    ])('refuses %p as a Dropbox content URL', (url) => {
        expect(P.isDropboxContentUrl(url)).toBe(false);
    });

    it('encodes the Drive file id into the download and thumbnail paths', () => {
        expect(P.downloadRequestFor('google_drive', 'a/b c').url).toBe('https://www.googleapis.com/drive/v3/files/a%2Fb%20c?alt=media&supportsAllDrives=true');
        expect(P.thumbnailRequestFor('google_drive', 'a/b').url).toContain('/files/a%2Fb?fields=thumbnailLink,hasThumbnail');
        expect(P.downloadRequestFor('onedrive', 'x')).toBeNull();
    });

    it('takes a Drive thumbnail only when the file has one', () => {
        const { pick } = P.thumbnailRequestFor('google_drive', 'id1');
        expect(pick({ hasThumbnail: true, thumbnailLink: 'https://t/x' })).toBe('https://t/x');
        expect(pick({ hasThumbnail: false, thumbnailLink: 'https://t/x' })).toBe('');
        expect(pick({ hasThumbnail: true })).toBe('');
        expect(pick(null)).toBe('');
    });

    it('clips input and accepts only https URLs without spaces', () => {
        expect(P.clip('x'.repeat(600))).toHaveLength(512);
        expect(P.clip('abcdef', 3)).toBe('abc');
        expect(P.clip(null)).toBe('');
        expect(P.isHttpsUrl('https://a.test/x')).toBe(true);
        expect(P.isHttpsUrl('http://a.test')).toBe(false);
        expect(P.isHttpsUrl('https://a.test/a b')).toBe(false);
    });
});

describe('providerApi.revoke — bearer vs form', () => {
    const api = require('../Modules/Connectors/providerApi');
    const google = require('../Modules/Connectors/providers/google');
    const dropbox = require('../Modules/Connectors/providers/dropbox');

    beforeEach(() => { mockProviderCalls.length = 0; });

    it('sends the token in the body for a form-style provider (Google)', async () => {
        await api.revoke({ definition: google, companyId: 'c', actor: 'u', token: 'refresh-tok' });
        expect(mockProviderCalls[0].opts.form).toEqual({ token: 'refresh-tok' });
        expect(mockProviderCalls[0].opts.token).toBeUndefined();
    });

    it('sends the token as a bearer header with an empty body for a bearer-style provider (Dropbox)', async () => {
        await api.revoke({ definition: dropbox, companyId: 'c', actor: 'u', token: 'access-tok' });
        expect(mockProviderCalls[0].opts.form).toEqual({});
        expect(mockProviderCalls[0].opts.token).toBe('access-tok');
    });
});

describe('pickerController — owner only, no cross-person id', () => {
    const apps = require('../Modules/Connectors/apps');
    const connections = require('../Modules/Connectors/resolveConnection');
    const picker = require('../Modules/Connectors/pickerController');

    const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
    const resFor = () => {
        const res = { code: 200, body: null };
        res.status = (c) => { res.code = c; return res; };
        res.send = (b) => { res.body = b; return res; };
        return res;
    };
    const reqFor = (over = {}) => ({ companyId: 'comp1', uid: 'maya', params: { source: 'google_drive' }, query: {}, body: {}, headers: {}, ...over });

    beforeEach(() => {
        jest.clearAllMocks();
        apps.resolveApp.mockResolvedValue({ source: 'instance', clientId: 'gid', clientSecret: 'x', extra: {} });
        connections.resolveConnection.mockResolvedValue({ connectionId: 'conn1', scopes: [DRIVE_SCOPE], getAccessToken: async () => 'owner-access-token' });
    });

    it('refuses an API token and a guest', async () => {
        const r1 = resFor();
        await picker.token(reqFor({ apiToken: { id: 't' } }), r1);
        expect(r1.code).toBe(403);
        const r2 = resFor();
        await picker.token(reqFor({ uid: 'guest' }), r2);
        expect(r2.code).toBe(403);
    });

    it('hands the owner their own Drive access token and never a connection from the request body', async () => {
        const res = resFor();
        await picker.token(reqFor(), res);
        expect(res.body.status).toBe(true);
        expect(res.body.data.token).toBe('owner-access-token');
        expect(connections.resolveConnection).toHaveBeenCalledWith(expect.objectContaining({ userId: 'maya', provider: 'google' }));
    });

    it('refuses the Drive token when the Drive product is not ticked', async () => {
        connections.resolveConnection.mockResolvedValue({ connectionId: 'conn1', scopes: [], getAccessToken: async () => 'x' });
        const res = resFor();
        await picker.token(reqFor(), res);
        expect(res.code).toBe(409);
        expect(res.body.code).toBe('scope_missing');
    });

    it('gives Dropbox the app key with no token and no connection', async () => {
        const res = resFor();
        await picker.token(reqFor({ params: { source: 'dropbox' } }), res);
        expect(res.body.data).toEqual({ token: '', config: { app_key: 'gid' } });
        expect(connections.resolveConnection).not.toHaveBeenCalled();
    });

    it('refuses a provider with no OAuth app set', async () => {
        apps.resolveApp.mockRejectedValue(new Error('no app'));
        const res = resFor();
        await picker.token(reqFor(), res);
        expect(res.code).toBe(404);
        expect(res.body.code).toBe('provider_off');
    });

    it('refuses a traversal path on import before fetching anything', async () => {
        const res = resFor();
        await picker.importFile(reqFor({ body: { fileId: 'f', path: '../etc/passwd' } }), res);
        expect(res.code).toBe(400);
        expect(connections.resolveConnection).not.toHaveBeenCalled();
    });

    it('imports against the session person, never a body-supplied id', async () => {
        const axios = require('axios');
        axios.mockResolvedValue({ data: Buffer.from('hello') });
        const res = resFor();
        await picker.importFile(reqFor({ body: { fileId: 'fid', path: 'ok/file.txt', userId: 'ruben' } }), res);
        expect(connections.resolveConnection).toHaveBeenCalledWith(expect.objectContaining({ userId: 'maya' }));
        expect(connections.resolveConnection).not.toHaveBeenCalledWith(expect.objectContaining({ userId: 'ruben' }));
    });
});
