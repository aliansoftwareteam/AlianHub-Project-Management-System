/**
 * Billing Math Test Suite
 * AlianHub Project Management System
 *
 * Unit tests for Modules/Milestone/helpers/billingMath.js. Pure — no DB.
 */

const {
    divRoundHalf,
    toMinor,
    fromMinor,
    minutesToMilliHours,
    extendLine,
    percentToBp,
    applyBp,
    shareBp,
    invoiceTotals,
    contractRollup,
    profitability,
    capUsage,
    milestoneBurn,
    formatMinor,
} = require('../Modules/Milestone/helpers/billingMath');

describe('🧾 BILLING MATH - minor units', () => {

    describe('divRoundHalf', () => {
        test('rounds halves away from zero in both directions', () => {
            expect(divRoundHalf(5, 10)).toBe(1);
            expect(divRoundHalf(4, 10)).toBe(0);
            expect(divRoundHalf(15, 10)).toBe(2);
            expect(divRoundHalf(-5, 10)).toBe(-1);
            expect(divRoundHalf(-15, 10)).toBe(-2);
        });

        test('a zero denominator is 0, never NaN or Infinity', () => {
            expect(divRoundHalf(100, 0)).toBe(0);
        });
    });

    describe('toMinor / fromMinor', () => {
        test('major to minor is exact for values a float cannot hold', () => {
            expect(toMinor(0.1)).toBe(10);
            expect(toMinor(0.07)).toBe(7);
            expect(toMinor(1.005)).toBe(101);
            expect(toMinor(12000)).toBe(1200000);
        });

        test('a third decimal rounds half-up, it is not truncated', () => {
            expect(toMinor(12.345)).toBe(1235);
            expect(toMinor(12.344)).toBe(1234);
            expect(toMinor(-12.345)).toBe(-1235);
        });

        test('strings with separators are accepted; junk is 0', () => {
            expect(toMinor('1,250.50')).toBe(125050);
            expect(toMinor('')).toBe(0);
            expect(toMinor('abc')).toBe(0);
            expect(toMinor(null)).toBe(0);
        });

        test('round-trips back to major units', () => {
            expect(fromMinor(toMinor(31780))).toBe(31780);
        });

        test('summing 0.1 ten times in minor units is exactly 1.00', () => {
            const cents = Array.from({ length: 10 }, () => toMinor(0.1));
            expect(fromMinor(cents.reduce((a, b) => a + b, 0))).toBe(1);
            // ...which the float version does not manage:
            expect(Array.from({ length: 10 }, () => 0.1).reduce((a, b) => a + b, 0)).not.toBe(1);
        });
    });

    describe('quantities', () => {
        test('minutes become exact milli-hours', () => {
            expect(minutesToMilliHours(90)).toBe(1500);
            expect(minutesToMilliHours(60)).toBe(1000);
            expect(minutesToMilliHours(0)).toBe(0);
        });

        test('20 minutes rounds to 333 milli-hours, not 333.33', () => {
            expect(minutesToMilliHours(20)).toBe(333);
            expect(Number.isInteger(minutesToMilliHours(20))).toBe(true);
        });

        test('a quantity at a rate extends to whole minor units', () => {
            expect(extendLine({ qtyMilli: 24000, unitMinor: 14000 })).toBe(336000);
            // 1.5h at $99.99 = $149.985 -> 14999 cents (half-up).
            expect(extendLine({ qtyMilli: 1500, unitMinor: 9999 })).toBe(14999);
        });
    });

    describe('rates in basis points', () => {
        test('percent converts to basis points', () => {
            expect(percentToBp(18)).toBe(1800);
            expect(percentToBp(7.5)).toBe(750);
            expect(percentToBp(0)).toBe(0);
        });

        test('applying a rate rounds half-up on the last cent', () => {
            // $10.05 at 7.5% = $0.75375 -> 75 cents.
            expect(applyBp(1005, 750)).toBe(75);
            // $10.10 at 7.5% = $0.7575 -> 76 cents (the half rounds up).
            expect(applyBp(1010, 750)).toBe(76);
        });

        test('shareBp is null when there is nothing to divide by', () => {
            expect(shareBp(50, 0)).toBeNull();
            expect(shareBp(1200000, 10000000)).toBe(1200);
        });
    });

    describe('invoiceTotals', () => {
        const lines = [
            { amountMinor: toMinor(28000) },
            { qtyMilli: 24000, unitMinor: toMinor(140) },
            { amountMinor: toMinor(420) },
        ];

        test('subtotal is the sum of the lines and total is subtotal + tax', () => {
            const t = invoiceTotals({ lines, taxRateBp: percentToBp(18) });
            expect(fromMinor(t.subtotalMinor)).toBe(31780);
            expect(fromMinor(t.taxMinor)).toBe(5720.4);
            expect(t.totalMinor).toBe(t.subtotalMinor + t.taxMinor);
            expect(fromMinor(t.totalMinor)).toBe(37500.4);
        });

        test('the printed total always equals subtotal + tax even when tax rounds', () => {
            const t = invoiceTotals({ lines: [{ amountMinor: 1005 }], taxRateBp: 750 });
            expect(t.subtotalMinor).toBe(1005);
            expect(t.taxMinor).toBe(75);
            expect(t.totalMinor).toBe(1080);
        });

        test('no lines is a zero invoice, not NaN', () => {
            const t = invoiceTotals({});
            expect(t).toMatchObject({ subtotalMinor: 0, taxMinor: 0, totalMinor: 0 });
        });
    });

    describe('contractRollup', () => {
        const milestones = [
            { id: 'm1', amountMinor: toMinor(12000) },
            { id: 'm2', amountMinor: toMinor(28000) },
            { id: 'm3', amountMinor: toMinor(42000) },
            { id: 'm4', amountMinor: toMinor(18000) },
        ];

        test('paid / invoiced-unpaid / remaining split from real invoice state', () => {
            const r = contractRollup({ milestones, paidMilestoneIds: ['m1'], invoicedMilestoneIds: ['m2'] });
            expect(fromMinor(r.totalMinor)).toBe(100000);
            expect(fromMinor(r.paidMinor)).toBe(12000);
            expect(fromMinor(r.invoicedUnpaidMinor)).toBe(28000);
            expect(fromMinor(r.remainingMinor)).toBe(60000);
            expect(r.paidBp).toBe(1200);
        });

        test('a milestone counted as paid is not counted again as invoiced', () => {
            const r = contractRollup({ milestones, paidMilestoneIds: ['m1'], invoicedMilestoneIds: ['m1', 'm2'] });
            expect(fromMinor(r.paidMinor)).toBe(12000);
            expect(fromMinor(r.invoicedUnpaidMinor)).toBe(28000);
        });

        test('cancelled milestones drop out of the contract total', () => {
            const r = contractRollup({ milestones: [...milestones, { id: 'm5', amountMinor: toMinor(9000), cancelled: true }] });
            expect(fromMinor(r.totalMinor)).toBe(100000);
        });
    });

    describe('profitability', () => {
        test('with a cost rate it reports cost and margin', () => {
            const p = profitability({ loggedMinutes: 394 * 60, blendedCostRateMinor: toMinor(58), billedMinor: toMinor(40000) });
            expect(p.hasCostRate).toBe(true);
            expect(p.hours).toBe(394);
            expect(fromMinor(p.costMinor)).toBe(22852);
            expect(fromMinor(p.marginMinor)).toBe(17148);
            expect(p.marginBp).toBe(4287);
        });

        test('with no cost rate it refuses to invent one', () => {
            const p = profitability({ loggedMinutes: 6000, billedMinor: toMinor(1000) });
            expect(p.hasCostRate).toBe(false);
            expect(p.costMinor).toBeNull();
            expect(p.marginBp).toBeNull();
            expect(p.hours).toBe(100);
        });

        test('a zero or negative rate is treated as unset, not as free labour', () => {
            expect(profitability({ loggedMinutes: 60, blendedCostRateMinor: 0 }).hasCostRate).toBe(false);
            expect(profitability({ loggedMinutes: 60, blendedCostRateMinor: -100 }).hasCostRate).toBe(false);
        });
    });

    describe('capUsage', () => {
        test('approved + pending against a monthly ceiling', () => {
            const c = capUsage({ approvedMinor: toMinor(16810), pendingMinor: toMinor(1955), capMinor: toMinor(20000) });
            expect(c.hasCap).toBe(true);
            expect(fromMinor(c.headroomMinor)).toBe(1235);
            expect(c.approvedBp).toBe(8405);
            expect(c.overCap).toBe(false);
        });

        test('over the cap is flagged', () => {
            const c = capUsage({ approvedMinor: toMinor(19000), pendingMinor: toMinor(2000), capMinor: toMinor(20000) });
            expect(c.overCap).toBe(true);
            expect(fromMinor(c.headroomMinor)).toBe(-1000);
        });

        test('no cap set reports hasCap false rather than an infinite ceiling', () => {
            const c = capUsage({ approvedMinor: 100, pendingMinor: 0 });
            expect(c.hasCap).toBe(false);
            expect(c.headroomMinor).toBeNull();
        });
    });

    describe('milestoneBurn', () => {
        test('flags a milestone burning value faster than it is completing', () => {
            const b = milestoneBurn({
                percentBp: 6800,
                loggedMinutes: 214 * 60,
                blendedCostRateMinor: toMinor(153),
                amountMinor: toMinor(42000),
            });
            expect(b.atRisk).toBe(true);
            expect(b.burnBp).toBeGreaterThan(b.percentBp);
            expect(b.projectedMarginBp).toBeLessThan(1000);
        });

        test('a healthy milestone is not flagged', () => {
            const b = milestoneBurn({
                percentBp: 6800,
                loggedMinutes: 100 * 60,
                blendedCostRateMinor: toMinor(58),
                amountMinor: toMinor(42000),
            });
            expect(b.atRisk).toBe(false);
        });

        test('with no cost rate there is no burn to report', () => {
            const b = milestoneBurn({ percentBp: 6800, loggedMinutes: 6000, amountMinor: toMinor(42000) });
            expect(b.hasCostRate).toBe(false);
            expect(b.burnBp).toBeNull();
            expect(b.atRisk).toBe(false);
        });
    });

    describe('formatMinor', () => {
        test('thousands separators and a sign', () => {
            expect(formatMinor(3750040)).toBe('$37,500.40');
            expect(formatMinor(-125000)).toBe('-$1,250.00');
            expect(formatMinor(0)).toBe('$0.00');
        });
    });
});
