// Auto-archive rule normalisation. Pure — no I/O, no app imports — so the
// controller, the cron runner, and the unit tests share one source of truth.

const DEFAULT_AFTER_DAYS = 30;
const MIN_AFTER_DAYS = 1;
const MAX_AFTER_DAYS = 365;

/* Clamp arbitrary input into a safe rule shape. */
function normaliseRule(input) {
    const enabled = input?.enabled === true;
    let afterDays = Number(input?.afterDays);
    if (!Number.isFinite(afterDays)) {
        afterDays = DEFAULT_AFTER_DAYS;
    }
    afterDays = Math.min(MAX_AFTER_DAYS, Math.max(MIN_AFTER_DAYS, Math.round(afterDays)));
    return { enabled, afterDays };
}

module.exports = {
    normaliseRule,
    DEFAULT_AFTER_DAYS,
    MIN_AFTER_DAYS,
    MAX_AFTER_DAYS,
};
