/* Sprint 8 slice 11: session cookies travel with the request and the server
 * reads them when no explicit header is sent. */
const { parse, readCookie, clearOptions, clearAuthCookies, handshakeToken } = require('../Config/cookies');

describe('cookie reads', () => {
    it('parses a cookie header into values', () => {
        expect(parse('accessToken=abc; refreshToken=def; refferCode=xyz')).toEqual({ accessToken: 'abc', refreshToken: 'def', refferCode: 'xyz' });
        expect(parse('')).toEqual({});
        expect(parse(undefined)).toEqual({});
        expect(parse('nonsense')).toEqual({});
    });

    it('reads a parsed jar first and the header otherwise', () => {
        expect(readCookie({ cookies: { accessToken: 'jar' }, headers: { cookie: 'accessToken=head' } }, 'accessToken')).toBe('jar');
        expect(readCookie({ headers: { cookie: 'accessToken=head' } }, 'accessToken')).toBe('head');
        expect(readCookie({ headers: {} }, 'accessToken')).toBe('');
        expect(readCookie({}, 'accessToken')).toBe('');
    });

    it('prefers an explicitly sent handshake token over the cookie', () => {
        const cookie = { headers: { cookie: 'accessToken=from-cookie' } };
        expect(handshakeToken({ auth: { token: 'from-auth' }, ...cookie })).toBe('from-auth');
        expect(handshakeToken({ auth: {}, ...cookie })).toBe('from-cookie');
        expect(handshakeToken({ auth: {} })).toBe('');
    });
});

describe('cookie clears match how the cookies were set', () => {
    const OLD_ENV = process.env.NODE_ENV;

    afterEach(() => { process.env.NODE_ENV = OLD_ENV; });

    it('clears host-only in development and by domain in production', () => {
        process.env.NODE_ENV = 'development';
        expect(clearOptions({ hostname: 'app.example.test' })).toEqual({ path: '/', domain: undefined });
        process.env.NODE_ENV = 'production';
        expect(clearOptions({ hostname: 'app.example.test' })).toEqual({ path: '/', domain: 'app.example.test' });
    });

    it('clears both session cookies through an express response', () => {
        const cleared = [];
        const res = { clearCookie: (name, options) => cleared.push([name, options]) };
        clearAuthCookies(res, { hostname: 'h' });
        expect(cleared.map(([name]) => name).sort()).toEqual(['accessToken', 'refreshToken']);
        expect(cleared[0][1]).toEqual({ path: '/', domain: undefined });
    });
});
