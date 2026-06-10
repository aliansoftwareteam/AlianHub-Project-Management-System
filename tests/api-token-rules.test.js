/**
 * API Token Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/ApiTokens/helpers/apiTokenRules.js. Pure — no DB.
 */

const {
    TOKEN_PREFIX,
    PREFIX_LENGTH,
    SCOPES,
    generateToken,
    hashToken,
    tokenPrefixOf,
    looksLikeToken,
    validateCreateInput,
    isExpired,
    hasScope,
} = require('../Modules/ApiTokens/helpers/apiTokenRules');

describe('🔑 API TOKENS - Rules', () => {

    describe('token generation', () => {

        test('tokens carry the prefix and 48 hex chars, and are unique', () => {
            const token = generateToken();
            expect(token.startsWith(TOKEN_PREFIX)).toBe(true);
            expect(token).toMatch(/^ahp_[0-9a-f]{48}$/);
            expect(generateToken()).not.toBe(token);
        });

        test('hash is deterministic and token-dependent', () => {
            const token = generateToken();
            expect(hashToken(token)).toBe(hashToken(token));
            expect(hashToken(token)).not.toBe(hashToken(generateToken()));
            expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
        });

        test('prefix extraction and shape detection', () => {
            const token = generateToken();
            expect(tokenPrefixOf(token)).toBe(token.slice(0, PREFIX_LENGTH));
            expect(looksLikeToken(token)).toBe(true);
            expect(looksLikeToken('ahp_short')).toBe(false);
            expect(looksLikeToken('jwt.abc.def')).toBe(false);
            expect(looksLikeToken(null)).toBe(false);
        });
    });

    describe('validateCreateInput', () => {

        test('name only is enough', () => {
            expect(validateCreateInput({ name: 'CI token' }).valid).toBe(true);
        });

        test('valid scopes and expiry pass', () => {
            expect(validateCreateInput({ name: 'T', scopes: ['read'], expiresInDays: 30 }).valid).toBe(true);
            expect(validateCreateInput({ name: 'T', scopes: [] }).valid).toBe(true);
        });

        test('bad name, scopes, expiry fail', () => {
            expect(validateCreateInput({ name: '' }).valid).toBe(false);
            expect(validateCreateInput({ name: 'x'.repeat(81) }).valid).toBe(false);
            expect(validateCreateInput({ name: 'T', scopes: ['admin'] }).valid).toBe(false);
            expect(validateCreateInput({ name: 'T', expiresInDays: 0 }).valid).toBe(false);
            expect(validateCreateInput({ name: 'T', expiresInDays: 9999 }).valid).toBe(false);
            expect(validateCreateInput({ name: 'T', expiresInDays: 1.5 }).valid).toBe(false);
        });
    });

    describe('isExpired / hasScope', () => {

        test('expiry logic', () => {
            const now = new Date('2026-06-10T12:00:00Z');
            expect(isExpired({}, now)).toBe(false);
            expect(isExpired({ expiresAt: '2026-07-01' }, now)).toBe(false);
            expect(isExpired({ expiresAt: '2026-06-01' }, now)).toBe(true);
        });

        test('empty scopes mean full access; otherwise explicit', () => {
            expect(hasScope({ scopes: [] }, 'read')).toBe(true);
            expect(hasScope({ scopes: ['read'] }, 'read')).toBe(true);
            expect(hasScope({ scopes: ['read'] }, 'write')).toBe(false);
            SCOPES.forEach((scope) => expect(hasScope({ scopes: [] }, scope)).toBe(true));
        });
    });
});
