const P = require('../Modules/CloudStorage/helpers/cloudProviders');

describe('cloud providers: lookup and setup state', () => {
    it('knows google_drive and dropbox and nothing else', () => {
        expect(P.PROVIDER_KEYS).toEqual(['google_drive', 'dropbox']);
        expect(P.isProvider('dropbox')).toBe(true);
        expect(P.isProvider('onedrive')).toBe(false);
        expect(P.isProvider(undefined)).toBe(false);
        expect(P.byKey('')).toBeNull();
    });

    it('treats Google Drive as set up only with both client id and secret', () => {
        expect(P.isConfigured('google_drive', { client_id: 'id', client_secret: 'sec' })).toBe(true);
        expect(P.isConfigured('google_drive', { client_id: 'id' })).toBe(false);
        expect(P.isConfigured('google_drive', { client_id: 'id', client_secret: '   ' })).toBe(false);
    });

    it('treats Dropbox as set up with the app key alone', () => {
        expect(P.isConfigured('dropbox', { app_key: 'k' })).toBe(true);
        expect(P.isConfigured('dropbox', {})).toBe(false);
    });

    it('is not configured for an unknown provider or a missing / non-object config', () => {
        expect(P.isConfigured('nope', { client_id: 'a', client_secret: 'b' })).toBe(false);
        expect(P.isConfigured('dropbox', null)).toBe(false);
        expect(P.isConfigured('dropbox', 'app_key')).toBe(false);
    });
});

describe('cloud providers: describe', () => {
    it('returns null for an unknown provider', () => {
        expect(P.describe('nope')).toBeNull();
    });

    it('returns a copy, so editing the description cannot change the provider', () => {
        const first = P.describe('google_drive');
        first.requirements.length = 0;
        first.requiredFields.push('x');
        const again = P.describe('google_drive');
        expect(again.requirements.length).toBeGreaterThan(0);
        expect(again.requiredFields).toEqual(['client_id', 'client_secret']);
    });

    it('marks secret fields and whether a redirect uri is needed', () => {
        const drive = P.describe('google_drive');
        expect(drive.needsRedirectUri).toBe(true);
        expect(drive.fields.find((f) => f.key === 'client_secret').secret).toBe(true);
        expect(drive.fields.find((f) => f.key === 'client_id').secret).toBe(false);
        expect(P.describe('dropbox').needsRedirectUri).toBe(false);
    });
});

describe('cloud providers: sanitizeAppConfig', () => {
    it('refuses an unknown provider', () => {
        expect(P.sanitizeAppConfig('nope', {})).toEqual({ valid: false, reason: 'Unknown provider.', config: {} });
    });

    it('keeps only declared fields and trims them', () => {
        const out = P.sanitizeAppConfig('google_drive', { client_id: '  id  ', client_secret: 's', evil: 'x' });
        expect(out.valid).toBe(true);
        expect(out.config).toEqual({ client_id: 'id', client_secret: 's' });
    });

    it('clips an over-long value to 512 characters', () => {
        const out = P.sanitizeAppConfig('dropbox', { app_key: 'k'.repeat(900) });
        expect(out.config.app_key).toHaveLength(512);
    });

    it('keeps the stored secret when the form leaves it blank', () => {
        const out = P.sanitizeAppConfig('google_drive', { client_id: 'new', client_secret: '' }, { client_secret: 'stored' });
        expect(out.valid).toBe(true);
        expect(out.config.client_secret).toBe('stored');
    });

    it('replaces the stored secret when a new one is given', () => {
        const out = P.sanitizeAppConfig('google_drive', { client_id: 'a', client_secret: 'fresh' }, { client_secret: 'stored' });
        expect(out.config.client_secret).toBe('fresh');
    });

    it('does not carry over a stored non-secret value that the form blanked', () => {
        const out = P.sanitizeAppConfig('google_drive', { client_id: 'a', client_secret: 's', api_key: '' }, { api_key: 'old' });
        expect(out.config.api_key).toBeUndefined();
    });

    it('names the missing required fields by their label', () => {
        const out = P.sanitizeAppConfig('google_drive', { api_key: 'k' });
        expect(out.valid).toBe(false);
        expect(out.reason).toBe('Required: OAuth client ID, OAuth client secret.');
    });

    it('survives a missing, array or null submission', () => {
        expect(P.sanitizeAppConfig('dropbox', undefined).valid).toBe(false);
        expect(P.sanitizeAppConfig('dropbox', ['app_key']).valid).toBe(false);
        expect(P.sanitizeAppConfig('dropbox', null, null).valid).toBe(false);
    });
});

describe('cloud providers: what the browser may see', () => {
    const stored = { client_id: 'id', client_secret: 'topsecret', api_key: 'key', app_id: '123' };

    it('redactAppConfig shows plain values and only whether each secret is set', () => {
        const out = P.redactAppConfig('google_drive', stored);
        expect(out.config).toEqual({ client_id: 'id', api_key: 'key', app_id: '123' });
        expect(out.secrets).toEqual({ client_secret: true });
        expect(JSON.stringify(out)).not.toContain('topsecret');
    });

    it('redactAppConfig reports an unset secret as false and blank plain fields as empty', () => {
        const out = P.redactAppConfig('google_drive', {});
        expect(out.secrets.client_secret).toBe(false);
        expect(out.config.client_id).toBe('');
    });

    it('redactAppConfig on an unknown provider returns empty shapes', () => {
        expect(P.redactAppConfig('nope', stored)).toEqual({ config: {}, secrets: {} });
    });

    it('publicConfig returns only the picker fields and never a secret', () => {
        expect(P.publicConfig('google_drive', stored)).toEqual({ client_id: 'id', api_key: 'key', app_id: '123' });
        expect(P.publicConfig('dropbox', { app_key: 'k', app_secret: 'shh' })).toEqual({ app_key: 'k' });
    });

    it('publicConfig leaves out unset fields and handles unknown providers', () => {
        expect(P.publicConfig('google_drive', { client_id: 'id', api_key: '' })).toEqual({ client_id: 'id' });
        expect(P.publicConfig('nope', stored)).toEqual({});
        expect(P.publicConfig('dropbox', null)).toEqual({});
    });
});

describe('cloud providers: OAuth urls and token bodies', () => {
    it('builds a Google consent url that asks for offline access to picked files only', () => {
        const url = new URL(P.buildAuthUrl({
            provider: 'google_drive',
            config: { client_id: 'cid' },
            redirectUri: 'https://app.test/cb',
            state: 'signed.state',
        }));
        expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
        expect(url.searchParams.get('client_id')).toBe('cid');
        expect(url.searchParams.get('redirect_uri')).toBe('https://app.test/cb');
        expect(url.searchParams.get('state')).toBe('signed.state');
        expect(url.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/drive.file');
        expect(url.searchParams.get('access_type')).toBe('offline');
        expect(url.searchParams.get('response_type')).toBe('code');
    });

    it('uses the Dropbox app key as the client id', () => {
        const url = new URL(P.buildAuthUrl({ provider: 'dropbox', config: { app_key: 'ak' }, redirectUri: 'r', state: 's' }));
        expect(url.searchParams.get('client_id')).toBe('ak');
        expect(url.searchParams.get('token_access_type')).toBe('offline');
    });

    it('returns an empty url for an unknown provider', () => {
        expect(P.buildAuthUrl({ provider: 'nope', config: {} })).toBe('');
        expect(P.authUrlFor('nope')).toBe('');
        expect(P.tokenUrlFor('nope')).toBe('');
        expect(P.tokenUrlFor('google_drive')).toBe('https://oauth2.googleapis.com/token');
    });

    it('encodes odd characters in the redirect uri and state', () => {
        const built = P.buildAuthUrl({ provider: 'google_drive', config: { client_id: 'c' }, redirectUri: 'https://a.test/cb?x=1&y=2', state: 'a b&c' });
        const url = new URL(built);
        expect(url.searchParams.get('redirect_uri')).toBe('https://a.test/cb?x=1&y=2');
        expect(url.searchParams.get('state')).toBe('a b&c');
    });

    it('builds the code exchange body', () => {
        const body = new URLSearchParams(P.tokenRequestBody({
            provider: 'google_drive', config: { client_id: 'c', client_secret: 's' }, code: 'abc', redirectUri: 'https://a.test/cb',
        }));
        expect(Object.fromEntries(body)).toEqual({
            client_id: 'c', client_secret: 's', grant_type: 'authorization_code', code: 'abc', redirect_uri: 'https://a.test/cb',
        });
    });

    it('builds the refresh body without a code or redirect uri', () => {
        const body = new URLSearchParams(P.tokenRequestBody({
            provider: 'dropbox', config: { app_key: 'k', app_secret: 'z' }, refreshToken: 'rt', code: 'ignored',
        }));
        expect(Object.fromEntries(body)).toEqual({ client_id: 'k', client_secret: 'z', grant_type: 'refresh_token', refresh_token: 'rt' });
    });
});

describe('cloud providers: account and file requests', () => {
    it('reads the account email and name from each provider shape', () => {
        expect(P.parseAccount('google_drive', { email: 'a@b.c', name: 'Ann' })).toEqual({ email: 'a@b.c', name: 'Ann' });
        expect(P.parseAccount('dropbox', { email: 'a@b.c', name: { display_name: 'Ann D' } })).toEqual({ email: 'a@b.c', name: 'Ann D' });
    });

    it('returns blanks for a missing payload or an unknown provider', () => {
        expect(P.parseAccount('google_drive', null)).toEqual({ email: '', name: '' });
        expect(P.parseAccount('dropbox', { email: 'a@b.c' })).toEqual({ email: 'a@b.c', name: '' });
        expect(P.parseAccount('other', { email: 'a@b.c' })).toEqual({ email: '', name: '' });
    });

    it('downloads Google files by an encoded id', () => {
        const req = P.downloadRequestFor('google_drive', 'a/b c');
        expect(req.url).toBe('https://www.googleapis.com/drive/v3/files/a%2Fb%20c?alt=media&supportsAllDrives=true');
    });

    it('downloads Dropbox files with the path in a header', () => {
        const req = P.downloadRequestFor('dropbox', '/Docs/a.pdf');
        expect(req.method).toBe('POST');
        expect(JSON.parse(req.headers['Dropbox-API-Arg'])).toEqual({ path: '/Docs/a.pdf' });
        expect(P.downloadRequestFor('other', 'x')).toBeNull();
    });

    it('picks the Google thumbnail only when the file has one', () => {
        const req = P.thumbnailRequestFor('google_drive', 'id1');
        expect(req.url).toContain('/files/id1?fields=thumbnailLink,hasThumbnail');
        expect(req.pick({ hasThumbnail: true, thumbnailLink: 'https://t/x' })).toBe('https://t/x');
        expect(req.pick({ hasThumbnail: false, thumbnailLink: 'https://t/x' })).toBe('');
        expect(req.pick({ hasThumbnail: true })).toBe('');
        expect(req.pick(null)).toBe('');
    });

    it('has no thumbnail lookup for Dropbox or unknown providers', () => {
        expect(P.thumbnailRequestFor('dropbox', 'x')).toBeNull();
        expect(P.thumbnailRequestFor('nope', 'x')).toBeNull();
    });
});
