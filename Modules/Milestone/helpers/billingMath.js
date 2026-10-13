// Billing arithmetic for contracts, milestones and invoices. Pure — no I/O —
// shared by the Milestone/Invoice controllers, the client-view projection and
// the tests.
//
// Every amount is carried as an INTEGER count of minor units (cents). A float
// dollar amount cannot represent 0.1 exactly, so a contract summed as floats
// drifts by a cent or two over a few dozen lines and the invoice total stops
// matching the sum of its own rows. Quantities are carried as milli-units
// (hours x 1000) for the same reason.

const MINOR_PER_MAJOR = 100;
const MILLI = 1000;
const BP_PER_UNIT = 10000;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);

/* Integer division rounding halves away from zero, so -0.5 and 0.5 both round
 * outward and a credit note mirrors the invoice it reverses. */
const divRoundHalf = (numerator, denominator) => {
    if (!denominator) return 0;
    const sign = (numerator < 0) !== (denominator < 0) ? -1 : 1;
    const n = Math.abs(numerator);
    const d = Math.abs(denominator);
    return sign * Math.floor((n * 2 + d) / (d * 2));
};

/* Major units (12.345) to minor units (1235 — half-up). Accepts strings so a
 * raw form value can be passed straight in. */
const toMinor = (value) => {
    const n = typeof value === 'string' ? Number(value.replace(/[\s,]/g, '')) : Number(value);
    if (!isFiniteNumber(n)) return 0;
    return divRoundHalf(Math.round(n * MINOR_PER_MAJOR * MILLI), MILLI);
};

const fromMinor = (minor) => (Number(minor) || 0) / MINOR_PER_MAJOR;

/* Logged minutes to hours-in-milli-units, so 90 minutes is exactly 1500. */
const minutesToMilliHours = (minutes) => divRoundHalf((Number(minutes) || 0) * MILLI, 60);

const milliHoursToHours = (milli) => (Number(milli) || 0) / MILLI;

const sumMinor = (values) => (values || []).reduce((total, v) => total + (Number(v) || 0), 0);

/* A quantity in milli-units at a unit price in minor units. */
const extendLine = ({ qtyMilli, unitMinor } = {}) => divRoundHalf(
    (Number(qtyMilli) || 0) * (Number(unitMinor) || 0),
    MILLI,
);

/* Percent as basis points: 18% is 1800. */
const percentToBp = (percent) => divRoundHalf(Math.round((Number(percent) || 0) * BP_PER_UNIT), 100);

const applyBp = (minor, bp) => divRoundHalf((Number(minor) || 0) * (Number(bp) || 0), BP_PER_UNIT);

/* Share of `part` in `whole`, in basis points. Null when there is nothing to
 * divide by — a caller must render "no data", not 0%. */
const shareBp = (part, whole) => {
    const w = Number(whole) || 0;
    if (!w) return null;
    return divRoundHalf((Number(part) || 0) * BP_PER_UNIT, w);
};

const bpToPercent = (bp) => (bp === null || bp === undefined ? null : (Number(bp) || 0) / 100);

/* A line is either a flat amount (a signed-off milestone, an expense) or a
 * quantity at a rate (out-of-scope hours). */
const lineAmountMinor = (line = {}) => {
    if (line.unitMinor === null || line.unitMinor === undefined || line.unitMinor === '') {
        return Number(line.amountMinor) || 0;
    }
    return extendLine({ qtyMilli: line.qtyMilli, unitMinor: line.unitMinor });
};

/* Invoice arithmetic. Tax is charged on the subtotal, not per line, so the
 * printed total always equals subtotal + tax. */
const invoiceTotals = ({ lines = [], taxRateBp = 0 } = {}) => {
    const amounts = (lines || []).map(lineAmountMinor);
    const subtotalMinor = sumMinor(amounts);
    const taxMinor = applyBp(subtotalMinor, taxRateBp);
    return { subtotalMinor, taxMinor, totalMinor: subtotalMinor + taxMinor, lineAmountsMinor: amounts };
};

/* Contract money panel: what the milestones are worth against what has actually
 * been invoiced and paid. `invoicedMilestoneIds` / `paidMilestoneIds` come from
 * the invoices, so nothing here is a guess about payment state. */
const contractRollup = ({ milestones = [], paidMilestoneIds = [], invoicedMilestoneIds = [] } = {}) => {
    const paid = new Set((paidMilestoneIds || []).map(String));
    const invoiced = new Set((invoicedMilestoneIds || []).map(String));
    let totalMinor = 0;
    let paidMinor = 0;
    let invoicedUnpaidMinor = 0;
    (milestones || []).forEach((m) => {
        if (!m || m.cancelled) return;
        const amount = Number(m.amountMinor) || 0;
        totalMinor += amount;
        const id = String(m.id);
        if (paid.has(id)) paidMinor += amount;
        else if (invoiced.has(id)) invoicedUnpaidMinor += amount;
    });
    return {
        totalMinor,
        paidMinor,
        invoicedUnpaidMinor,
        remainingMinor: totalMinor - paidMinor - invoicedUnpaidMinor,
        paidBp: shareBp(paidMinor, totalMinor),
        invoicedUnpaidBp: shareBp(invoicedUnpaidMinor, totalMinor),
    };
};

/* Profitability needs a cost rate, and there is no honest default for one — a
 * blended rate is a company's own number. Without it the caller gets
 * `hasCostRate: false` and must show a "set a rate" state rather than a zero. */
const profitability = ({ loggedMinutes = 0, blendedCostRateMinor = null, billedMinor = 0 } = {}) => {
    const milliHours = minutesToMilliHours(loggedMinutes);
    const hasCostRate = isFiniteNumber(Number(blendedCostRateMinor)) && Number(blendedCostRateMinor) > 0;
    if (!hasCostRate) {
        return {
            hasCostRate: false,
            milliHours,
            hours: milliHoursToHours(milliHours),
            costMinor: null,
            billedMinor: Number(billedMinor) || 0,
            marginMinor: null,
            marginBp: null,
        };
    }
    const costMinor = extendLine({ qtyMilli: milliHours, unitMinor: blendedCostRateMinor });
    const billed = Number(billedMinor) || 0;
    return {
        hasCostRate: true,
        milliHours,
        hours: milliHoursToHours(milliHours),
        costMinor,
        billedMinor: billed,
        marginMinor: billed - costMinor,
        marginBp: shareBp(billed - costMinor, billed),
    };
};

/* Hourly mode: how much of the monthly ceiling the approved and pending hours
 * have eaten. A contract with no cap set returns hasCap: false. */
const capUsage = ({ approvedMinor = 0, pendingMinor = 0, capMinor = null } = {}) => {
    const approved = Number(approvedMinor) || 0;
    const pending = Number(pendingMinor) || 0;
    const hasCap = isFiniteNumber(Number(capMinor)) && Number(capMinor) > 0;
    if (!hasCap) {
        return { hasCap: false, approvedMinor: approved, pendingMinor: pending, headroomMinor: null, approvedBp: null, pendingBp: null, overCap: false };
    }
    const cap = Number(capMinor);
    return {
        hasCap: true,
        capMinor: cap,
        approvedMinor: approved,
        pendingMinor: pending,
        headroomMinor: cap - approved - pending,
        approvedBp: shareBp(approved, cap),
        pendingBp: shareBp(pending, cap),
        overCap: approved + pending > cap,
    };
};

/* The "Watch:" strip on the contract panel. A milestone that is X% done but has
 * burned Y% of its value in cost is only worth flagging when Y outruns X — and
 * only when there is a cost rate to compute Y from at all. */
const milestoneBurn = ({ percentBp = null, loggedMinutes = 0, blendedCostRateMinor = null, amountMinor = 0 } = {}) => {
    const amount = Number(amountMinor) || 0;
    const p = profitability({ loggedMinutes, blendedCostRateMinor, billedMinor: amount });
    if (!p.hasCostRate || !amount) {
        return { hasCostRate: p.hasCostRate, burnBp: null, percentBp, atRisk: false, projectedMarginBp: null };
    }
    const burnBp = shareBp(p.costMinor, amount);
    const done = Number(percentBp) || 0;
    // Extrapolate the burn to completion at the current rate.
    const projectedCostMinor = done > 0 ? divRoundHalf(p.costMinor * BP_PER_UNIT, done) : null;
    return {
        hasCostRate: true,
        burnBp,
        percentBp,
        costMinor: p.costMinor,
        atRisk: done > 0 && burnBp > done,
        projectedMarginBp: projectedCostMinor === null ? null : shareBp(amount - projectedCostMinor, amount),
    };
};

/* Display only — the server never formats money it also does maths on. */
const formatMinor = (minor, { symbol = '$', exponent = 2 } = {}) => {
    const value = fromMinor(minor);
    const abs = Math.abs(value).toFixed(exponent).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${value < 0 ? '-' : ''}${symbol}${abs}`;
};

module.exports = {
    MINOR_PER_MAJOR,
    MILLI,
    BP_PER_UNIT,
    divRoundHalf,
    toMinor,
    fromMinor,
    minutesToMilliHours,
    milliHoursToHours,
    sumMinor,
    extendLine,
    percentToBp,
    applyBp,
    shareBp,
    bpToPercent,
    lineAmountMinor,
    invoiceTotals,
    contractRollup,
    profitability,
    capUsage,
    milestoneBurn,
    formatMinor,
};
