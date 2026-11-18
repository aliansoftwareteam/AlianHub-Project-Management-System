jest.mock('../Config/loggerConfig', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const hint = require('../Modules/Auth/helpers/workspaceHint');

const ENV = { WORKSPACE_HINT_DOMAIN: 'alianhub.com', NODE_ENV: 'production' };

const response = () => {
    const res = { set: [], cleared: [] };
    res.cookie = (name, value, options) => res.set.push({ name, value, options });
    res.clearCookie = (name, options) => res.cleared.push({ name, options });
    return res;
};
const request = (hostname, cookie = '') => ({ hostname, headers: { cookie } });

describe('workspace hint label', () => {
    it('is the subdomain of a managed workspace under the hint domain', () => {
        expect(hint.labelFor('abb.alianhub.com', { env: ENV, managed: true })).toBe('abb');
        expect(hint.labelFor('ABB.AlianHub.com.', { env: ENV, managed: true })).toBe('abb');
    });

    it('is nothing for a self-hosted instance, a custom domain, a deeper host or no hint domain', () => {
        expect(hint.labelFor('abb.alianhub.com', { env: ENV, managed: false })).toBeNull();
        expect(hint.labelFor('pm.abb.com', { env: ENV, managed: true })).toBeNull();
        expect(hint.labelFor('x.abb.alianhub.com', { env: ENV, managed: true })).toBeNull();
        expect(hint.labelFor('alianhub.com', { env: ENV, managed: true })).toBeNull();
        expect(hint.labelFor('evilalianhub.com', { env: ENV, managed: true })).toBeNull();
        expect(hint.labelFor('abb.alianhub.com', { env: {}, managed: true })).toBeNull();
        expect(hint.labelFor('abb.alianhub.com', { env: { WORKSPACE_HINT_DOMAIN: 'not a domain' }, managed: true })).toBeNull();
    });
});

describe('workspace hint list', () => {
    it('keeps labels only, newest first, without repeats, at most five', () => {
        expect(hint.parseHint('abb, xyz,ABB,<script>,a.b,,')).toEqual(['abb', 'xyz']);
        expect(hint.mergeHint('xyz,abb', 'abb')).toEqual(['abb', 'xyz']);
        expect(hint.mergeHint('a1,a2,a3,a4,a5', 'new')).toEqual(['new', 'a1', 'a2', 'a3', 'a4']);
        expect(hint.removeFromHint('abb,xyz', 'abb')).toEqual(['xyz']);
    });
});

describe('remembering and forgetting a workspace', () => {
    it('sets an HttpOnly, Secure, Lax cookie on the hint domain on sign-in', () => {
        const res = response();
        hint.rememberWorkspace(request('abb.alianhub.com', 'ah_ws=xyz'), res, { env: ENV, managed: true });
        expect(res.set).toEqual([{
            name: 'ah_ws',
            value: 'abb,xyz',
            options: { domain: 'alianhub.com', path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: hint.MAX_AGE_MS },
        }]);
    });

    it('removes the workspace on sign-out, and the cookie once it is empty', () => {
        const partly = response();
        hint.forgetWorkspace(request('abb.alianhub.com', 'ah_ws=abb,xyz'), partly, { env: ENV, managed: true });
        expect(partly.set[0].value).toBe('xyz');

        const emptied = response();
        hint.forgetWorkspace(request('abb.alianhub.com', 'ah_ws=abb'), emptied, { env: ENV, managed: true });
        expect(emptied.set).toEqual([]);
        expect(emptied.cleared).toEqual([{ name: 'ah_ws', options: expect.objectContaining({ domain: 'alianhub.com', path: '/' }) }]);
    });

    it('writes nothing where no label applies', () => {
        const res = response();
        hint.rememberWorkspace(request('hub.example.com'), res, { env: ENV, managed: true });
        hint.rememberWorkspace(request('abb.alianhub.com'), res, { env: ENV, managed: false });
        expect(res.set).toEqual([]);
        expect(res.cleared).toEqual([]);
    });

    it('never throws into the sign-in it rides on', () => {
        const res = { cookie: () => { throw new Error('headers sent'); } };
        expect(() => hint.rememberWorkspace(request('abb.alianhub.com'), res, { env: ENV, managed: true })).not.toThrow();
    });
});
