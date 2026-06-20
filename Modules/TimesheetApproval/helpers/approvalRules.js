// Timesheet approval rules. Pure — no I/O — shared by controller and tests.
//
// A "timesheet" here is a per-user, per-period submission (one document in the
// per-company `timesheet_approval` collection). Employees submit a period;
// owners/admins approve, reject (with a reason) or reopen it. Raw time entries
// in the `timesheets` collection are never mutated by this workflow.

const OBJECT_ID_PATTERN = /^[0-9a-fA-F]{24}$/;
const MAX_NOTE_LENGTH = 500;
const MAX_REASON_LENGTH = 500;

// Workflow states.
const APPROVAL_STATUSES = Object.freeze(['submitted', 'approved', 'rejected']);
// Manager review actions.
const REVIEW_ACTIONS = Object.freeze(['approve', 'reject', 'reopen']);

// Owner / Admin are the default timesheet approvers (mirrors permissionGuard).
const ROLE_OWNER = 1;
const ROLE_ADMIN = 2;

const isObjectIdString = (id) => OBJECT_ID_PATTERN.test(String(id || ''));
const isApprovalStatus = (s) => APPROVAL_STATUSES.includes(String(s || ''));

/* Only owner/admin may review (approve/reject/reopen) timesheets. */
const canReview = ({ roleType } = {}) => roleType === ROLE_OWNER || roleType === ROLE_ADMIN;

/* Parse + validate a submission period. Both bounds required; start <= end.
 * Both bounds are normalised to the START of their day so a given calendar
 * period always maps to the same stored value (stable identity for upsert /
 * status lookup). Returns { valid, reason, periodStart: Date, periodEnd: Date }. */
const parsePeriod = ({ periodStart, periodEnd } = {}) => {
    const toDay = (v) => {
        if (v === null || v === undefined || v === '') return false;
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) return false;
        d.setHours(0, 0, 0, 0);
        return d;
    };
    const start = toDay(periodStart);
    if (start === false) return { valid: false, reason: 'A valid periodStart is required.' };
    const end = toDay(periodEnd);
    if (end === false) return { valid: false, reason: 'A valid periodEnd is required.' };
    if (start.getTime() > end.getTime()) {
        return { valid: false, reason: 'periodStart must be on or before periodEnd.' };
    }
    return { valid: true, reason: '', periodStart: start, periodEnd: end };
};

/* Validate a submit request. Returns { valid, reason, periodStart, periodEnd }. */
const validateSubmitInput = ({ userId, periodStart, periodEnd, note } = {}) => {
    if (!isObjectIdString(userId)) {
        return { valid: false, reason: 'A valid userId is required.' };
    }
    if (note !== undefined && note !== null && String(note).length > MAX_NOTE_LENGTH) {
        return { valid: false, reason: `note must be ${MAX_NOTE_LENGTH} characters or fewer.` };
    }
    const period = parsePeriod({ periodStart, periodEnd });
    if (!period.valid) return period;
    return { valid: true, reason: '', periodStart: period.periodStart, periodEnd: period.periodEnd };
};

/* Resolve a review action against the current status.
 *   approve : submitted        -> approved
 *   reject  : submitted        -> rejected
 *   reopen  : approved|rejected -> submitted
 * Returns { valid, to, reason }. */
const resolveTransition = ({ from, action } = {}) => {
    if (!REVIEW_ACTIONS.includes(String(action || ''))) {
        return { valid: false, to: null, reason: `action must be one of: ${REVIEW_ACTIONS.join(', ')}.` };
    }
    if (!isApprovalStatus(from)) {
        return { valid: false, to: null, reason: 'The timesheet is not in a reviewable state.' };
    }
    if (action === 'approve') {
        if (from !== 'submitted') return { valid: false, to: null, reason: 'Only a submitted timesheet can be approved.' };
        return { valid: true, to: 'approved', reason: '' };
    }
    if (action === 'reject') {
        if (from !== 'submitted') return { valid: false, to: null, reason: 'Only a submitted timesheet can be rejected.' };
        return { valid: true, to: 'rejected', reason: '' };
    }
    // reopen
    if (from !== 'approved' && from !== 'rejected') {
        return { valid: false, to: null, reason: 'Only an approved or rejected timesheet can be reopened.' };
    }
    return { valid: true, to: 'submitted', reason: '' };
};

/* Validate a rejection reason (required + bounded). */
const validateReason = (reason) => {
    if (!reason || !String(reason).trim()) return { valid: false, reason: 'A rejection reason is required.' };
    if (String(reason).length > MAX_REASON_LENGTH) return { valid: false, reason: `reason must be ${MAX_REASON_LENGTH} characters or fewer.` };
    return { valid: true, reason: '' };
};

/* Normalise a value to local start-of-day Date (null if invalid). TIME-03. */
const startOfDay = (d) => {
    if (d === null || d === undefined || d === '') return null;
    const x = new Date(d);
    if (Number.isNaN(x.getTime())) return null;
    x.setHours(0, 0, 0, 0);
    return x;
};

/* TIME-03 — does an approved period [periodStart, periodEnd] cover `date`?
 * Day-granular and inclusive of both ends. */
const coversDate = ({ periodStart, periodEnd, date } = {}) => {
    const s = startOfDay(periodStart);
    const e = startOfDay(periodEnd);
    const d = startOfDay(date);
    if (!s || !e || !d) return false;
    return s.getTime() <= d.getTime() && d.getTime() <= e.getTime();
};

module.exports = {
    APPROVAL_STATUSES,
    REVIEW_ACTIONS,
    ROLE_OWNER,
    ROLE_ADMIN,
    MAX_NOTE_LENGTH,
    MAX_REASON_LENGTH,
    isObjectIdString,
    isApprovalStatus,
    canReview,
    parsePeriod,
    validateSubmitInput,
    resolveTransition,
    validateReason,
    startOfDay,
    coversDate,
};
