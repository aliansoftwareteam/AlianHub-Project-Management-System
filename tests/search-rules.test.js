/**
 * Global Search Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/GlobalSearch/helpers/searchRules.js. Pure — no DB.
 */

const {
    MIN_QUERY_LENGTH,
    MAX_QUERY_LENGTH,
    validateSearchInput,
    truncate,
} = require('../Modules/GlobalSearch/helpers/searchRules');

describe('🔎 GLOBAL SEARCH - Rules', () => {

    describe('validateSearchInput', () => {

        test('a normal query passes', () => {
            expect(validateSearchInput({ companyId: 'c1', query: 'login bug' }).valid).toBe(true);
        });

        test('missing companyId fails', () => {
            const result = validateSearchInput({ companyId: '', query: 'login' });
            expect(result.valid).toBe(false);
            expect(result.reason).toMatch(/companyId/);
        });

        test('too-short and whitespace-only queries fail', () => {
            expect(validateSearchInput({ companyId: 'c1', query: 'a' }).valid).toBe(false);
            expect(validateSearchInput({ companyId: 'c1', query: '   ' }).valid).toBe(false);
            expect(MIN_QUERY_LENGTH).toBeGreaterThan(1);
        });

        test('over-long queries fail', () => {
            expect(validateSearchInput({ companyId: 'c1', query: 'x'.repeat(MAX_QUERY_LENGTH + 1) }).valid).toBe(false);
        });

        test('trims before measuring', () => {
            expect(validateSearchInput({ companyId: 'c1', query: '  ok  ' }).valid).toBe(true);
        });
    });

    describe('truncate', () => {

        test('short strings pass through', () => {
            expect(truncate('hello')).toBe('hello');
        });

        test('long strings cut with ellipsis at the limit', () => {
            const out = truncate('x'.repeat(300), 120);
            expect(out.length).toBe(120);
            expect(out.endsWith('…')).toBe(true);
        });

        test('null-safe', () => {
            expect(truncate(null)).toBe('');
        });
    });
});
