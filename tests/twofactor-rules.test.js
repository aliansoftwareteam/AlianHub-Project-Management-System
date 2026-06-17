const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const rules = require('../Modules/Auth/helpers/twoFactorRules');

describe('twoFactorRules — TOTP', () => {
    test('generateSecret returns a non-empty base32 string and varies per call', () => {
        const a = rules.generateSecret();
        const b = rules.generateSecret();
        expect(typeof a).toBe('string');
        expect(a.length).toBeGreaterThan(0);
        expect(a).not.toBe(b);
    });

    test('verifyTotp accepts a freshly generated token and rejects malformed/wrong-secret', () => {
        const secret = rules.generateSecret();
        const token = rules.generateTotp(secret);
        expect(rules.verifyTotp(token, secret)).toBe(true);
        expect(rules.verifyTotp('12345', secret)).toBe(false); // malformed → rejected deterministically
        expect(rules.verifyTotp(token, rules.generateSecret())).toBe(false); // wrong secret
    });

    test('isValidTotpFormat', () => {
        expect(rules.isValidTotpFormat('123456')).toBe(true);
        expect(rules.isValidTotpFormat(' 123456 ')).toBe(true);
        expect(rules.isValidTotpFormat('12345')).toBe(false);
        expect(rules.isValidTotpFormat('abcdef')).toBe(false);
        expect(rules.isValidTotpFormat('')).toBe(false);
    });
});

describe('twoFactorRules — recovery codes', () => {
    test('generates the requested count of unique, well-formed codes', () => {
        const codes = rules.generateRecoveryCodes();
        expect(codes).toHaveLength(rules.RECOVERY_COUNT);
        expect(new Set(codes).size).toBe(codes.length);
        codes.forEach((c) => expect(c).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/));
    });

    test('hash + verify round-trips, tolerates formatting, rejects wrong codes', async () => {
        const [code] = rules.generateRecoveryCodes(1);
        const hash = await rules.hashRecoveryCode(code);
        expect(await rules.verifyRecoveryCode(code, hash)).toBe(true);
        // dash stripped + case-insensitive on compare
        expect(await rules.verifyRecoveryCode(code.replace('-', '').toUpperCase(), hash)).toBe(true);
        expect(await rules.verifyRecoveryCode('00000-00000', hash)).toBe(false);
        expect(await rules.verifyRecoveryCode('', hash)).toBe(false);
    });
});

describe('twoFactorRules — secret encryption (AES-256-GCM)', () => {
    const key = crypto.scryptSync('test-material', 'salt', 32);

    test('encrypt → decrypt round-trips and ciphertext does not leak the secret', () => {
        const secret = rules.generateSecret();
        const enc = rules.encryptSecret(secret, key);
        expect(enc).not.toContain(secret);
        expect(rules.decryptSecret(enc, key)).toBe(secret);
    });

    test('wrong key or tampered payload fails closed (null)', () => {
        const enc = rules.encryptSecret('JBSWY3DPEHPK3PXP', key);
        const otherKey = crypto.scryptSync('other-material', 'salt', 32);
        expect(rules.decryptSecret(enc, otherKey)).toBeNull();
        expect(rules.decryptSecret('garbage', key)).toBeNull();
        expect(rules.decryptSecret('', key)).toBeNull();
    });
});

describe('twoFactorRules — tempToken', () => {
    const secret = 'temp-secret-for-test';

    test('issue → verify returns the uid with the pending claim', () => {
        const t = rules.issueTempToken('u123', secret);
        expect(rules.verifyTempToken(t, secret)).toEqual({ uid: 'u123' });
    });

    test('rejects a token signed with a different secret', () => {
        const t = rules.issueTempToken('u123', secret);
        expect(rules.verifyTempToken(t, 'different-secret')).toBeNull();
    });

    test('rejects a normal JWT lacking the twoFactorPending claim', () => {
        const normal = jwt.sign({ uid: 'u123' }, secret, { algorithm: 'HS256' });
        expect(rules.verifyTempToken(normal, secret)).toBeNull();
    });
});
