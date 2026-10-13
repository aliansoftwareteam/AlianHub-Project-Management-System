const jwt = require('jsonwebtoken');
const R = require('../Modules/CloudStorage/helpers/cloudStorageRules');

const OLD_SECRET = process.env.JWT_SECRET;
beforeAll(() => { process.env.JWT_SECRET = 'unit-test-secret'; });
afterAll(() => { process.env.JWT_SECRET = OLD_SECRET; });

const base = { companyId: 'c1', userId: 'u1', provider: 'google_drive', returnTo: '/files', returnOrigin: 'http://localhost:8080' };

describe('cloud storage state token', () => {
    it('round-trips who the grant belongs to', () => {
        const decoded = R.decodeState(R.encodeState(base));
        expect(decoded).toMatchObject({ companyId: 'c1', userId: 'u1', provider: 'google_drive', returnTo: '/files', returnOrigin: 'http://localhost:8080' });
    });

    it('rejects a state signed with another secret', () => {
        const forged = R.encodeState(base, 'attacker-secret');
        expect(R.decodeState(forged)).toBeNull();
    });

    it('rejects a state meant for another audience', () => {
        const other = jwt.sign({ companyId: 'c1', userId: 'u1', provider: 'dropbox' }, `${process.env.JWT_SECRET}::cloud-storage-state`, { audience: 'someone-else' });
        expect(R.decodeState(other)).toBeNull();
    });

    it('rejects an expired state', () => {
        const expired = jwt.sign({ companyId: 'c1', userId: 'u1', provider: 'dropbox' }, `${process.env.JWT_SECRET}::cloud-storage-state`, { audience: R.STATE_AUDIENCE, expiresIn: -10 });
        expect(R.decodeState(expired)).toBeNull();
    });

    it('rejects a state naming an unknown provider', () => {
        const odd = jwt.sign({ companyId: 'c1', userId: 'u1', provider: 'onedrive' }, `${process.env.JWT_SECRET}::cloud-storage-state`, { audience: R.STATE_AUDIENCE });
        expect(R.decodeState(odd)).toBeNull();
    });

    it('rejects a state with no company or user', () => {
        const noUser = jwt.sign({ companyId: 'c1', provider: 'dropbox' }, `${process.env.JWT_SECRET}::cloud-storage-state`, { audience: R.STATE_AUDIENCE });
        expect(R.decodeState(noUser)).toBeNull();
    });

    it('rejects garbage, empty and missing input', () => {
        expect(R.decodeState('not-a-jwt')).toBeNull();
        expect(R.decodeState('')).toBeNull();
        expect(R.decodeState(undefined)).toBeNull();
    });

    it('drops an absolute return url when minting', () => {
        const decoded = R.decodeState(R.encodeState({ ...base, returnTo: 'https://evil.test/x' }));
        expect(decoded.returnTo).toBe('');
    });
});

describe('safeReturnPath', () => {
    it.each([
        ['/projects/1?tab=files', '/projects/1?tab=files'],
        ['/', '/'],
    ])('keeps the same-origin path %s', (input, expected) => {
        expect(R.safeReturnPath(input)).toBe(expected);
    });

    it.each(['//evil.test', '/\\evil.test', 'https://evil.test', 'javascript:alert(1)', 'files', '', null, undefined])(
        'refuses %p',
        (input) => { expect(R.safeReturnPath(input)).toBe(''); },
    );

    it('cuts a very long path at 512 characters', () => {
        expect(R.safeReturnPath(`/${'a'.repeat(900)}`)).toHaveLength(512);
    });
});

describe('isDropboxContentUrl', () => {
    it.each([
        'https://dl.dropboxusercontent.com/s/abc/file.pdf',
        'https://www.dropbox.com/s/abc/file.pdf?dl=1',
        'https://uc1234abcd.dl.dropboxusercontent.com/cd/0/get/x',
        'https://DL.DROPBOXUSERCONTENT.COM/x',
    ])('accepts %s', (url) => { expect(R.isDropboxContentUrl(url)).toBe(true); });

    it.each([
        'http://dl.dropboxusercontent.com/x',
        'file:///etc/passwd',
        'https://169.254.169.254/latest/meta-data',
        'https://evil.test/dropbox.com',
        'https://dl.dropboxusercontent.com@evil.test/x',
        'https://user:pw@dl.dropboxusercontent.com/x',
        'https://notdropbox.com/x',
        'https://dl.dropboxusercontent.com.evil.test/x',
        'https://dl.dropboxusercontent.com/a b',
        '',
        null,
    ])('refuses %p', (url) => { expect(R.isDropboxContentUrl(url)).toBe(false); });
});

describe('isExpired', () => {
    const now = new Date('2026-01-01T12:00:00Z');

    it('treats a missing or unreadable expiry as expired', () => {
        expect(R.isExpired(null, now)).toBe(true);
        expect(R.isExpired('not a date', now)).toBe(true);
    });

    it('treats a token as expired one minute early', () => {
        expect(R.isExpired(new Date('2026-01-01T12:00:59Z'), now)).toBe(true);
        expect(R.isExpired(new Date('2026-01-01T12:01:01Z'), now)).toBe(false);
    });

    it('accepts ISO strings and millis', () => {
        expect(R.isExpired('2026-01-01T13:00:00Z', now)).toBe(false);
        expect(R.isExpired(now.getTime() - 1, now)).toBe(true);
    });
});

describe('isHttpsUrl and clip', () => {
    it('accepts only https urls without spaces', () => {
        expect(R.isHttpsUrl('https://a.test/x')).toBe(true);
        expect(R.isHttpsUrl('http://a.test')).toBe(false);
        expect(R.isHttpsUrl('https://a.test/a b')).toBe(false);
        expect(R.isHttpsUrl(undefined)).toBe(false);
    });

    it('clips to 512 by default, a given max otherwise, and blanks null', () => {
        expect(R.clip('x'.repeat(600))).toHaveLength(512);
        expect(R.clip('abcdef', 3)).toBe('abc');
        expect(R.clip(null)).toBe('');
        expect(R.clip(undefined)).toBe('');
        expect(R.clip(12345, 3)).toBe('123');
    });
});
