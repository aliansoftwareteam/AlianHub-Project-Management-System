jest.mock('../Config/loggerConfig', () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn() }));

const crypto = require('crypto');
const logger = require('../Config/loggerConfig');
const { buildIceServers, buildTurnCredential } = require('../Modules/Calls/iceConfig');

beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2025-01-01T00:00:00Z'));
});
afterEach(() => jest.useRealTimers());

const NOW = Math.floor(new Date('2025-01-01T00:00:00Z').getTime() / 1000);

describe('buildIceServers', () => {
    test('with nothing configured a call has no servers, and no warning', () => {
        expect(buildIceServers({}, 'u1')).toEqual([]);
        expect(logger.warn).not.toHaveBeenCalled();
    });

    test('STUN addresses are split on commas, trimmed, and blanks dropped', () => {
        expect(buildIceServers({ STUN_URLS: ' stun:a.test:3478 , ,stun:b.test ' }, 'u1')).toEqual([{ urls: ['stun:a.test:3478', 'stun:b.test'] }]);
    });

    test('a TURN secret gives a short-lived credential for this person', () => {
        const [server] = buildIceServers({ TURN_URLS: 'turn:t.test:3478', TURN_STATIC_AUTH_SECRET: 's3cret' }, 'u1');
        expect(server.urls).toEqual(['turn:t.test:3478']);
        expect(server.username).toBe(`${NOW + 3600}:u1`);
        expect(server.credential).toBe(crypto.createHmac('sha1', 's3cret').update(server.username).digest('base64'));
    });

    test('the credential lifetime follows TURN_CREDENTIAL_TTL_SECONDS, and a bad value goes back to an hour', () => {
        const ttl = (value) => buildIceServers({ TURN_URLS: 'turn:t', TURN_STATIC_AUTH_SECRET: 's', TURN_CREDENTIAL_TTL_SECONDS: value }, 'u')[0].username;
        expect(ttl('600')).toBe(`${NOW + 600}:u`);
        expect(ttl('0')).toBe(`${NOW + 3600}:u`);
        expect(ttl('-5')).toBe(`${NOW + 3600}:u`);
        expect(ttl('soon')).toBe(`${NOW + 3600}:u`);
    });

    test('the secret wins over a static username and password', () => {
        const [server] = buildIceServers({ TURN_URLS: 'turn:t', TURN_STATIC_AUTH_SECRET: 's', TURN_USERNAME: 'u', TURN_PASSWORD: 'p' }, 'u1');
        expect(server.username).not.toBe('u');
    });

    test('static TURN credentials are used when there is no secret', () => {
        expect(buildIceServers({ TURN_URLS: 'turn:t', TURN_USERNAME: 'bob', TURN_PASSWORD: 'pw' }, 'u1')).toEqual([
            { urls: ['turn:t'], username: 'bob', credential: 'pw' },
        ]);
    });

    test('TURN addresses without any credentials are ignored, with a warning for the operator', () => {
        expect(buildIceServers({ TURN_URLS: 'turn:t', TURN_USERNAME: 'bob' }, 'u1')).toEqual([]);
        expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    test('a blank secret counts as no secret', () => {
        expect(buildIceServers({ TURN_URLS: 'turn:t', TURN_STATIC_AUTH_SECRET: '   ' }, 'u1')).toEqual([]);
    });

    test('STUN and TURN together come back in that order', () => {
        const servers = buildIceServers({ STUN_URLS: 'stun:s', TURN_URLS: 'turn:t', TURN_USERNAME: 'a', TURN_PASSWORD: 'b' }, 'u1');
        expect(servers.map((s) => s.urls[0])).toEqual(['stun:s', 'turn:t']);
    });
});

describe('buildTurnCredential', () => {
    test('a caller with no user id is named anon', () => {
        expect(buildTurnCredential('s', undefined, 60).username).toBe(`${NOW + 60}:anon`);
    });

    test('a different secret gives a different credential for the same user', () => {
        expect(buildTurnCredential('a', 'u', 60).credential).not.toBe(buildTurnCredential('b', 'u', 60).credential);
    });
});
