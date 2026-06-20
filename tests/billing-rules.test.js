/**
 * Billing Rules Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/TimeSheet/helpers/billingRules.js. Pure — no DB.
 */

const { validateRateInput, resolveRate, buildInvoice } = require('../Modules/TimeSheet/helpers/billingRules');

describe('💰 BILLING - Rates & Invoicing', () => {

    describe('validateRateInput', () => {
        test('valid user rate', () => expect(validateRateInput({ scope: 'user', refId: 'u1', rate: 50 }).valid).toBe(true));
        test('valid default rate (no refId)', () => expect(validateRateInput({ scope: 'default', rate: 40 }).valid).toBe(true));
        test('bad scope fails', () => expect(validateRateInput({ scope: 'team', rate: 50 }).valid).toBe(false));
        test('user rate needs refId', () => expect(validateRateInput({ scope: 'user', rate: 50 }).valid).toBe(false));
        test('negative rate fails', () => expect(validateRateInput({ scope: 'default', rate: -1 }).valid).toBe(false));
    });

    describe('resolveRate (precedence)', () => {
        const rates = [
            { scope: 'default', refId: '', rate: 10 },
            { scope: 'project', refId: 'p1', rate: 20 },
            { scope: 'user', refId: 'u1', rate: 30 },
        ];
        test('user beats project + default', () => expect(resolveRate({ entry: { Loggeduser: 'u1', ProjectId: 'p1' }, rates })).toBe(30));
        test('project beats default', () => expect(resolveRate({ entry: { Loggeduser: 'u9', ProjectId: 'p1' }, rates })).toBe(20));
        test('falls back to default', () => expect(resolveRate({ entry: { Loggeduser: 'u9', ProjectId: 'p9' }, rates })).toBe(10));
        test('no rates -> 0', () => expect(resolveRate({ entry: { Loggeduser: 'u9' }, rates: [] })).toBe(0));
    });

    describe('buildInvoice', () => {
        const rates = [{ scope: 'user', refId: 'u1', rate: 60 }, { scope: 'default', rate: 30 }];
        const entries = [
            { Loggeduser: 'u1', ProjectId: 'p1', LogTimeDuration: 120, billable: true }, // 2h @60 = 120
            { Loggeduser: 'u2', ProjectId: 'p1', LogTimeDuration: 60, billable: true },  // 1h @30 (default) = 30
            { Loggeduser: 'u1', ProjectId: 'p1', LogTimeDuration: 30, billable: false }, // excluded
        ];
        test('groups by user, applies rates, excludes non-billable', () => {
            const inv = buildInvoice({ entries, rates, currency: 'USD' });
            const u1 = inv.lineItems.find((l) => l.userId === 'u1');
            const u2 = inv.lineItems.find((l) => l.userId === 'u2');
            expect(u1.hours).toBe(2);
            expect(u1.amount).toBe(120);
            expect(u2.amount).toBe(30);
            expect(inv.subtotal).toBe(150);
            expect(inv.total).toBe(150);
            expect(inv.billableMinutes).toBe(180);
        });
        test('defaultRate fallback when no configured rate', () => {
            const inv = buildInvoice({ entries: [{ Loggeduser: 'x', ProjectId: 'y', LogTimeDuration: 60, billable: true }], rates: [], defaultRate: 25 });
            expect(inv.total).toBe(25);
        });
        test('empty entries -> zero invoice', () => {
            const inv = buildInvoice({ entries: [], rates });
            expect(inv.lineItems).toEqual([]);
            expect(inv.total).toBe(0);
        });
    });
});
