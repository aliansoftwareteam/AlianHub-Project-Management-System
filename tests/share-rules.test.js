/**
 * Public Share Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/PublicShares/helpers/shareRules.js. Pure — no DB.
 */

const {
    generateShareToken,
    isShareToken,
    validateCreateShare,
    validateIntakeSubmission,
    escapeHtml,
} = require('../Modules/PublicShares/helpers/shareRules');

const COMPANY = '64b7f0c2a1b2c3d4e5f60700';
const SPRINT = '64b7f0c2a1b2c3d4e5f60711';

describe('🌐 PUBLIC SHARES - Rules', () => {

    describe('tokens', () => {

        test('generated tokens are 32 hex chars, unique, and recognised', () => {
            const token = generateShareToken();
            expect(token).toMatch(/^[0-9a-f]{32}$/);
            expect(isShareToken(token)).toBe(true);
            expect(generateShareToken()).not.toBe(token);
        });

        test('junk tokens are rejected', () => {
            expect(isShareToken('short')).toBe(false);
            expect(isShareToken(null)).toBe(false);
            expect(isShareToken('Z'.repeat(32))).toBe(false);
        });
    });

    describe('validateCreateShare', () => {

        test('sprint shares pass; unknown entity types fail', () => {
            expect(validateCreateShare({ companyId: COMPANY, entityType: 'sprint', entityId: SPRINT }).valid).toBe(true);
            expect(validateCreateShare({ companyId: COMPANY, entityType: 'page', entityId: SPRINT }).valid).toBe(false);
        });

        test('missing companyId or bad entityId fail', () => {
            expect(validateCreateShare({ companyId: '', entityType: 'sprint', entityId: SPRINT }).valid).toBe(false);
            expect(validateCreateShare({ companyId: COMPANY, entityType: 'sprint', entityId: 'bad' }).valid).toBe(false);
        });
    });

    describe('validateIntakeSubmission', () => {

        test('title-only submissions pass', () => {
            expect(validateIntakeSubmission({ title: 'Feature request' }).valid).toBe(true);
        });

        test('limits enforced', () => {
            expect(validateIntakeSubmission({ title: '' }).valid).toBe(false);
            expect(validateIntakeSubmission({ title: 'x'.repeat(201) }).valid).toBe(false);
            expect(validateIntakeSubmission({ title: 'ok', description: 'x'.repeat(5001) }).valid).toBe(false);
            expect(validateIntakeSubmission({ title: 'ok', name: 'x'.repeat(121) }).valid).toBe(false);
        });
    });

    describe('escapeHtml', () => {

        test('escapes the dangerous five', () => {
            expect(escapeHtml(`<img src=x onerror="alert('xss')">&`)).toBe('&lt;img src=x onerror=&quot;alert(&#39;xss&#39;)&quot;&gt;&amp;');
        });

        test('null-safe', () => {
            expect(escapeHtml(null)).toBe('');
            expect(escapeHtml(undefined)).toBe('');
        });
    });
});
