const { normaliseWorkspaceAddress, workspaceHost, sameWorkspace } = require('../time-tracker-app/renderer/utils/workspaceAddress');
const { interpretHandshake, runHandshake, compareVersions, HANDSHAKE_PATH } = require('../time-tracker-app/renderer/utils/handshake');
const { setWorkspaceBase, withWorkspaceBase, workspaceUrl } = require('../time-tracker-app/renderer/utils/workspaceBase');

describe('a typed workspace address', () => {
    it.each([
        ['acme', 'https://acme.alianhub.com'],
        ['  Acme  ', 'https://acme.alianhub.com'],
        ['acme-labs', 'https://acme-labs.alianhub.com'],
        ['acme.alianhub.com', 'https://acme.alianhub.com'],
        ['https://acme.alianhub.com/', 'https://acme.alianhub.com'],
        ['https://acme.alianhub.com/#/login', 'https://acme.alianhub.com'],
        ['hub.example.com', 'https://hub.example.com'],
        ['hub.example.com:8443', 'https://hub.example.com:8443'],
        ['https://example.com/alianhub/', 'https://example.com/alianhub'],
        ['https://example.com/alianhub/index.html', 'https://example.com/alianhub'],
        ['https://HUB.Example.com?x=1', 'https://hub.example.com'],
        ['localhost:4000', 'http://localhost:4000'],
        ['localhost', 'http://localhost'],
        ['http://127.0.0.1:4000', 'http://127.0.0.1:4000'],
        ['http://hub.localhost:4000', 'http://hub.localhost:4000'],
    ])('reads %j as %s', (typed, url) => {
        expect(normaliseWorkspaceAddress(typed)).toEqual({ ok: true, url });
    });

    it.each([
        ['', 'empty'],
        ['   ', 'empty'],
        [null, 'empty'],
        ['http://hub.example.com', 'insecure'],
        ['http://192.168.1.10:4000', 'insecure'],
        ['ftp://hub.example.com', 'invalid'],
        ['https://user:secret@hub.example.com', 'invalid'],
        ['acme corp', 'invalid'],
        ['javascript:alert(1)', 'invalid'],
    ])('refuses %j (%s)', (typed, reason) => {
        expect(normaliseWorkspaceAddress(typed)).toEqual({ ok: false, reason });
    });

    it('keeps the plain-http address an older build shipped with', () => {
        expect(normaliseWorkspaceAddress('http://192.168.1.10:4000/', { allowHttp: true })).toEqual({ ok: true, url: 'http://192.168.1.10:4000' });
    });

    it('shows the host, and the path of an install under one', () => {
        expect(workspaceHost('https://acme.alianhub.com')).toBe('acme.alianhub.com');
        expect(workspaceHost('https://example.com/alianhub')).toBe('example.com/alianhub');
        expect(sameWorkspace('acme', 'https://acme.alianhub.com/')).toBe(true);
        expect(sameWorkspace('acme', 'beta')).toBe(false);
    });
});

describe('the handshake', () => {
    const answer = (data) => ({ data: { status: true, statusText: 'Tracker handshake.', data } });
    const handshake = (tracker, extra = {}) => answer({ app: 'alianhub', version: '14.41.0', name: 'Acme', logoUrl: '/api/v1/getLogo?key=logo&type=desktop', tracker, managed: true, ...extra });
    const workspace = { name: 'Acme', logoUrl: '/api/v1/getLogo?key=logo&type=desktop', managed: true };

    it('connects when the plan has the tracker', () => {
        expect(interpretHandshake(handshake({ enabled: true, minVersion: '6.0.0' }), '6.0.0')).toEqual({ outcome: 'ok', workspace });
    });

    it('stops at the plan message when the tracker is not in the plan', () => {
        expect(interpretHandshake(handshake({ enabled: false, minVersion: '6.0.0' }), '6.0.0')).toEqual({ outcome: 'disabled', workspace });
    });

    it('asks for an update when the tracker is older than the server accepts', () => {
        expect(interpretHandshake(handshake({ enabled: true, minVersion: '6.2.0' }), '6.1.9')).toEqual({ outcome: 'tooOld', minVersion: '6.2.0', workspace });
        expect(interpretHandshake(handshake({ enabled: true, minVersion: '6.2.0' }), '6.10.0').outcome).toBe('ok');
    });

    it('says the address could not be reached when nothing answered', () => {
        expect(interpretHandshake({ error: Object.assign(new Error('Network Error'), { request: {} }) }, '6.0.0')).toEqual({ outcome: 'unreachable' });
        expect(interpretHandshake({ error: Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' }) }, '6.0.0')).toEqual({ outcome: 'unreachable' });
    });

    it.each([
        ['a server without the route', { error: Object.assign(new Error('404'), { response: { status: 404, data: '<html>Not found</html>' } }) }],
        ['a site that is not AlianHub', { data: '<!doctype html><title>Welcome</title>' }],
        ['another app\'s JSON', answer({ app: 'something-else', tracker: { enabled: true } })],
        ['an AlianHub answer without the tracker block', answer({ app: 'alianhub' })],
        ['an empty body', { data: '' }],
    ])('says no AlianHub workspace answered for %s', (_label, response) => {
        expect(interpretHandshake(response, '6.0.0')).toEqual({ outcome: 'notAlianHub' });
    });

    it('asks the workspace address with a time limit', async () => {
        const get = jest.fn(async () => handshake({ enabled: true, minVersion: '6.0.0' }));
        const result = await runHandshake('https://acme.alianhub.com', '6.0.0', get);
        expect(get).toHaveBeenCalledWith(`https://acme.alianhub.com${HANDSHAKE_PATH}`, { timeout: 10000 });
        expect(result.outcome).toBe('ok');
    });

    it('turns a failed request into an outcome instead of throwing', async () => {
        const get = jest.fn(async () => { throw Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }); });
        await expect(runHandshake('https://nowhere.example.test', '6.0.0', get)).resolves.toEqual({ outcome: 'unreachable' });
    });

    it('compares versions by number', () => {
        expect(compareVersions('6.0.0-beta.1', '6.0.0')).toBe(0);
        expect(compareVersions('5.1.6', '6.0.0')).toBe(-1);
        expect(compareVersions('6.10.0', '6.9.0')).toBe(1);
    });
});

describe('the address each request goes to', () => {
    afterEach(() => setWorkspaceBase(''));

    it('is read on every request, so a switch moves the next request', () => {
        setWorkspaceBase('https://acme.alianhub.com');
        expect(withWorkspaceBase({ url: '/api/v1/user/u1', headers: { a: 1 } })).toEqual({ url: '/api/v1/user/u1', headers: { a: 1 }, baseURL: 'https://acme.alianhub.com' });
        setWorkspaceBase('https://beta.alianhub.com/');
        expect(withWorkspaceBase({ url: '/api/v1/user/u1' }).baseURL).toBe('https://beta.alianhub.com');
        expect(workspaceUrl('/#/oauth2')).toBe('https://beta.alianhub.com/#/oauth2');
    });

    it('refuses to send a request before a workspace is connected', () => {
        expect(() => withWorkspaceBase({ url: '/api/v1/user/u1' })).toThrow('No workspace is connected');
    });
});
