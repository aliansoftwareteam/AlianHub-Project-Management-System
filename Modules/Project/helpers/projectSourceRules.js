/**
 * Pure rules for a project's `source` and the proposal id that goes with it.
 *
 * Two proposal-id fields are stored on purpose:
 *   proposalId        — what the manager typed, cleaned (the "~…" form survives)
 *   proposalIdNumeric — the digits-only id when one can be derived
 *
 * The bidding DB's `proposals.proposalId` holds 19-digit numeric ids, so the
 * central dashboard joins on `proposalIdNumeric` and falls back to `proposalId`.
 * Overloading the single existing field would have silently changed the meaning
 * of a column that repo already consumes.
 */

const PROJECT_SOURCES = ['upwork', 'fiverr', 'other'];
const DEFAULT_SOURCE = 'other';
const MAX_PROPOSAL_ID = 100;

// A real Upwork numeric id is 19 digits; 15 is a safe floor for "this is the
// numeric form" without matching a stray year or invoice number.
const NUMERIC_ID = /^\d{15,}$/;
const NUMERIC_RUN = /\d{15,}/;
// Post-cleaning shape of an Upwork reference: the "~" is stripped, so what's left
// is the bare id — all digits (which matches the bidding DB) or hex.
const UPWORK_ID = /^[0-9a-f]{15,}$/i;

/** Slug for a submitted source, or null when it isn't one of the three. */
const normaliseSource = (value) => {
    const slug = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
    return PROJECT_SOURCES.includes(slug) ? slug : null;
};

/** Projects created before this field existed read as the default. */
const sourceOrDefault = (value) => normaliseSource(value) || DEFAULT_SOURCE;

/**
 * Reduce a pasted proposal reference to the id alone. Accepts the bare id, the
 * "~…" form, or a full Upwork URL, and strips the decoration people copy with
 * it: quotes, trailing slash, and the leading "~".
 *
 * Dropping the "~" is what makes the mapping work: Upwork's URL reference is
 * "~" + the same id the bidding DB stores, so once the prefix is gone an
 * all-digit reference equals `proposals.proposalId` directly.
 */
const cleanProposalId = (raw) => {
    let value = String(raw === undefined || raw === null ? '' : raw).trim().replace(/^["']|["']$/g, '');
    if (value.includes('://') || /upwork\.com|fiverr\.com/i.test(value)) {
        const withoutQuery = value.split(/[?#]/)[0];
        const segments = withoutQuery.split('/').filter(Boolean);
        value = segments.length ? segments[segments.length - 1] : '';
    }
    return value.replace(/\/+$/, '').replace(/^~+/, '').trim().slice(0, MAX_PROPOSAL_ID);
};

/**
 * The digits-only id the warehouse joins on, or '' when the input carries none —
 * a hex reference has no numeric form, and '' is honester than a guess.
 */
const numericProposalId = (cleaned) => {
    const value = String(cleaned === undefined || cleaned === null ? '' : cleaned).trim();
    if (NUMERIC_ID.test(value)) return value;
    if (UPWORK_ID.test(value)) return '';
    const run = value.match(NUMERIC_RUN);
    return run ? run[0] : '';
};

/**
 * Cross-field check. Upwork projects must carry a proposal id; a shape we don't
 * recognise is a warning, never a rejection — formats drift, and a hard block
 * would strand a legitimate id nobody can enter.
 */
const validateProposalId = (source, cleaned) => {
    const value = String(cleaned === undefined || cleaned === null ? '' : cleaned).trim();
    if (sourceOrDefault(source) !== 'upwork') {
        return { valid: true, warning: null };
    }
    if (!value) return { valid: false, reason: 'PROPOSAL_ID_REQUIRED_FOR_UPWORK' };
    return { valid: true, warning: UPWORK_ID.test(value) ? null : 'PROPOSAL_ID_FORMAT_UNEXPECTED' };
};

module.exports = {
    PROJECT_SOURCES,
    DEFAULT_SOURCE,
    MAX_PROPOSAL_ID,
    normaliseSource,
    sourceOrDefault,
    cleanProposalId,
    numericProposalId,
    validateProposalId,
};
