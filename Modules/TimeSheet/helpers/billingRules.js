// TIME-07 billing rules. Pure — no I/O — shared by the controller and tests.

const RATE_SCOPES = Object.freeze(['user', 'project', 'default']);

/* Validate a rate definition. Returns { valid, reason }. */
const validateRateInput = ({ scope, refId, rate } = {}) => {
    if (!RATE_SCOPES.includes(String(scope))) {
        return { valid: false, reason: `scope must be one of: ${RATE_SCOPES.join(', ')}.` };
    }
    if (scope !== 'default' && !String(refId || '').trim()) {
        return { valid: false, reason: 'refId is required for a user or project rate.' };
    }
    const r = Number(rate);
    if (!Number.isFinite(r) || r < 0) {
        return { valid: false, reason: 'rate must be a non-negative number.' };
    }
    return { valid: true, reason: '' };
};

/* Hourly rate for a time entry, by precedence: user > project > default > 0. */
const resolveRate = ({ entry = {}, rates = [] } = {}) => {
    const list = rates || [];
    const userRate = list.find((r) => r.scope === 'user' && String(r.refId) === String(entry.Loggeduser));
    if (userRate) return Number(userRate.rate) || 0;
    const projectRate = list.find((r) => r.scope === 'project' && String(r.refId) === String(entry.ProjectId));
    if (projectRate) return Number(projectRate.rate) || 0;
    const def = list.find((r) => r.scope === 'default');
    if (def) return Number(def.rate) || 0;
    return 0;
};

/* Build an invoice from billable time entries, grouped by user.
 * Non-billable entries (billable === false) are excluded. defaultRate is a
 * fallback when no configured rate matches. */
const buildInvoice = ({ entries = [], rates = [], currency = 'USD', defaultRate = 0 } = {}) => {
    const byUser = {};
    let billableMinutes = 0;
    (entries || []).forEach((e) => {
        if (!e || e.billable === false) return;
        const mins = Number(e.LogTimeDuration) || 0;
        if (mins <= 0) return;
        let rate = resolveRate({ entry: e, rates });
        if (!rate && defaultRate) rate = Number(defaultRate) || 0;
        const key = String(e.Loggeduser || 'unknown');
        if (!byUser[key]) byUser[key] = { userId: key, minutes: 0, amount: 0 };
        byUser[key].minutes += mins;
        byUser[key].amount += (mins / 60) * rate;
        billableMinutes += mins;
    });
    const lineItems = Object.values(byUser).map((li) => ({
        userId: li.userId,
        hours: Number((li.minutes / 60).toFixed(2)),
        amount: Number(li.amount.toFixed(2)),
    }));
    const subtotal = Number(lineItems.reduce((s, li) => s + li.amount, 0).toFixed(2));
    return { currency, lineItems, subtotal, total: subtotal, billableMinutes };
};

module.exports = { RATE_SCOPES, validateRateInput, resolveRate, buildInvoice };
