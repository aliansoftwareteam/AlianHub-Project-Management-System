/**
 * Audit Rules Test Suite (SEC-04)
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Audit/helpers/auditRules.js. Pure — no DB.
 */

const { normalizeAuditEntry, retentionCutoff, RETENTION_DEFAULT_DAYS } = require('../Modules/Audit/helpers/auditRules');

describe('🗒️ AUDIT - Rules (SEC-04)', () => {

    describe('normalizeAuditEntry', () => {
        test('valid entry shapes all fields', () => {
            const r = normalizeAuditEntry({ actorId: 'u1', actorName: 'Ann', action: 'member.role_change', entityType: 'member', entityId: 'm1', meta: { from: 3, to: 2 } });
            expect(r.valid).toBe(true);
            expect(r.entry.action).toBe('member.role_change');
            expect(r.entry.meta).toEqual({ from: 3, to: 2 });
        });
        test('action is required', () => {
            expect(normalizeAuditEntry({ actorId: 'u1' }).valid).toBe(false);
            expect(normalizeAuditEntry({ action: '   ' }).valid).toBe(false);
        });
        test('non-object meta is dropped to {}', () => {
            expect(normalizeAuditEntry({ action: 'x', meta: 'nope' }).entry.meta).toEqual({});
            expect(normalizeAuditEntry({ action: 'x', meta: [1, 2] }).entry.meta).toEqual({});
        });
        test('long action is bounded', () => {
            expect(normalizeAuditEntry({ action: 'a'.repeat(500) }).entry.action.length).toBe(120);
        });
        test('missing optional fields become empty strings', () => {
            const e = normalizeAuditEntry({ action: 'x' }).entry;
            expect(e.actorId).toBe('');
            expect(e.entityId).toBe('');
        });
    });

    describe('retentionCutoff', () => {
        test('default retention is 365 days', () => {
            const now = new Date('2026-06-20T00:00:00Z');
            const cutoff = retentionCutoff(now);
            const days = Math.round((now - cutoff) / 86400000);
            expect(days).toBe(RETENTION_DEFAULT_DAYS);
        });
        test('custom retention', () => {
            const now = new Date('2026-06-20T00:00:00Z');
            const days = Math.round((now - retentionCutoff(now, 30)) / 86400000);
            expect(days).toBe(30);
        });
        test('invalid retention falls back to default', () => {
            const now = new Date('2026-06-20T00:00:00Z');
            const days = Math.round((now - retentionCutoff(now, -5)) / 86400000);
            expect(days).toBe(RETENTION_DEFAULT_DAYS);
        });
    });
});
