const { encrypt, decrypt, isEncrypted, sealFields, openFields } = require('../utils/secretField');

beforeAll(() => { process.env.JWT_SECRET = 'test-secret'; });

describe('secretField', () => {
    test('round-trips a value and never stores it in plaintext', () => {
        const sealed = encrypt('ghp_supersecrettoken');
        expect(sealed).not.toContain('ghp_supersecrettoken');
        expect(isEncrypted(sealed)).toBe(true);
        expect(decrypt(sealed)).toBe('ghp_supersecrettoken');
    });

    test('is idempotent: an already-encrypted value is not encrypted twice', () => {
        const once = encrypt('abc');
        expect(encrypt(once)).toBe(once);
    });

    test('empty values stay empty and plaintext reads through unchanged', () => {
        expect(encrypt('')).toBe('');
        expect(encrypt(null)).toBe('');
        expect(isEncrypted('https://hooks.zapier.com/a:b:c')).toBe(false);
        expect(decrypt('legacy-plaintext')).toBe('legacy-plaintext');
    });

    test('tampered ciphertext or a rotated key fails closed', () => {
        const sealed = encrypt('abc');
        expect(decrypt(sealed.slice(0, -2) + 'zz')).toBeNull();
        process.env.JWT_SECRET = 'rotated';
        expect(decrypt(sealed)).toBeNull();
        process.env.JWT_SECRET = 'test-secret';
    });

    test('sealFields / openFields only touch the named keys', () => {
        const sealed = sealFields({ token: 't0k', repo: 'a/b' }, ['token', 'missing']);
        expect(sealed.repo).toBe('a/b');
        expect(isEncrypted(sealed.token)).toBe(true);
        expect(sealed).not.toHaveProperty('missing');
        expect(openFields(sealed, ['token'])).toEqual({ token: 't0k', repo: 'a/b' });
    });
});
