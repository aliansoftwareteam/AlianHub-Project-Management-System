const {
    isAllowedRedirectUri, validRedirectUris, matchesRegistered, MAX_URIS,
} = require('../Modules/OAuthServer/redirectUri');

describe('isAllowedRedirectUri', () => {
    test('an https address is allowed', () => {
        expect(isAllowedRedirectUri('https://app.example.com/callback')).toBe(true);
        expect(isAllowedRedirectUri('https://app.example.com:8443/cb?x=1')).toBe(true);
    });

    test('plain http is allowed only on this machine', () => {
        expect(isAllowedRedirectUri('http://localhost:3000/cb')).toBe(true);
        expect(isAllowedRedirectUri('http://127.0.0.1/cb')).toBe(true);
        expect(isAllowedRedirectUri('http://[::1]:8080/cb')).toBe(true);
        expect(isAllowedRedirectUri('http://app.example.com/cb')).toBe(false);
        expect(isAllowedRedirectUri('http://localhost.evil.com/cb')).toBe(false);
    });

    test('a fragment, a user name or a password is refused', () => {
        expect(isAllowedRedirectUri('https://app.example.com/cb#frag')).toBe(false);
        expect(isAllowedRedirectUri('https://app.example.com/cb#')).toBe(false);
        expect(isAllowedRedirectUri('https://user@app.example.com/cb')).toBe(false);
        expect(isAllowedRedirectUri('https://user:pw@app.example.com/cb')).toBe(false);
    });

    test('an address that the browser would rewrite is refused, so it cannot land elsewhere', () => {
        expect(isAllowedRedirectUri('https://APP.example.com/cb')).toBe(false);
        expect(isAllowedRedirectUri('https://app.example.com\\evil.com/cb')).toBe(false);
        expect(isAllowedRedirectUri(' https://app.example.com/cb')).toBe(false);
        expect(isAllowedRedirectUri('https://app.example.com')).toBe(false);
    });

    test('other schemes and things that are not text are refused', () => {
        expect(isAllowedRedirectUri('javascript:alert(1)')).toBe(false);
        expect(isAllowedRedirectUri('myapp://callback')).toBe(false);
        expect(isAllowedRedirectUri('not a url')).toBe(false);
        expect(isAllowedRedirectUri('')).toBe(false);
        expect(isAllowedRedirectUri(null)).toBe(false);
        expect(isAllowedRedirectUri(42)).toBe(false);
    });

    test('an address of 2000 characters is the longest allowed', () => {
        const base = 'https://a.example.com/';
        expect(isAllowedRedirectUri(base + 'x'.repeat(2000 - base.length))).toBe(true);
        expect(isAllowedRedirectUri(base + 'x'.repeat(2001 - base.length))).toBe(false);
    });
});

describe('validRedirectUris', () => {
    test('needs a list of one to ten good addresses', () => {
        expect(validRedirectUris(['https://a.example.com/cb'])).toBe(true);
        expect(validRedirectUris(Array.from({ length: MAX_URIS }, (_, i) => `https://a.example.com/${i}`))).toBe(true);
        expect(validRedirectUris(Array.from({ length: MAX_URIS + 1 }, (_, i) => `https://a.example.com/${i}`))).toBe(false);
    });

    test('one bad address spoils the list, and an empty or missing list is refused', () => {
        expect(validRedirectUris(['https://a.example.com/cb', 'http://a.example.com/cb'])).toBe(false);
        expect(validRedirectUris([])).toBe(false);
        expect(validRedirectUris(undefined)).toBe(false);
        expect(validRedirectUris('https://a.example.com/cb')).toBe(false);
    });
});

describe('matchesRegistered', () => {
    const client = { redirectUris: ['https://app.example.com/cb', 'http://localhost:5000/auth?x=1'] };

    test('an exact registered address matches', () => {
        expect(matchesRegistered(client, 'https://app.example.com/cb')).toBe(true);
    });

    test('a different path or a trailing slash does not match', () => {
        expect(matchesRegistered(client, 'https://app.example.com/cb/')).toBe(false);
        expect(matchesRegistered(client, 'https://app.example.com/other')).toBe(false);
    });

    test('a native app on loopback may come back on any port', () => {
        expect(matchesRegistered(client, 'http://localhost:61234/auth?x=1')).toBe(true);
        expect(matchesRegistered(client, 'http://localhost/auth?x=1')).toBe(true);
    });

    test('the port is the only thing that may differ: path, query and host must be the same', () => {
        expect(matchesRegistered(client, 'http://localhost:61234/auth?x=2')).toBe(false);
        expect(matchesRegistered(client, 'http://localhost:61234/other?x=1')).toBe(false);
        expect(matchesRegistered(client, 'http://127.0.0.1:61234/auth?x=1')).toBe(false);
    });

    test('an https address on another port is not matched by the loopback rule', () => {
        expect(matchesRegistered(client, 'https://app.example.com:8443/cb')).toBe(false);
    });

    test('an address that is not allowed never matches, even if it was registered', () => {
        expect(matchesRegistered({ redirectUris: ['http://app.example.com/cb'] }, 'http://app.example.com/cb')).toBe(false);
    });

    test('a client with no list, or a value that is not text, matches nothing', () => {
        expect(matchesRegistered({}, 'https://app.example.com/cb')).toBe(false);
        expect(matchesRegistered(client, undefined)).toBe(false);
        expect(matchesRegistered(client, 5)).toBe(false);
    });
});
