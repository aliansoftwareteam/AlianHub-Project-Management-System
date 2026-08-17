// Mirrors Modules/Project/helpers/projectSourceRules.js. The server is the
// authority — this exists so the forms can require and hint before a round trip.

export const PROJECT_SOURCES = ['upwork', 'fiverr', 'other'];
export const DEFAULT_SOURCE = 'other';

const UPWORK_ID = /^[0-9a-f]{15,}$/i;

/**
 * Reduce a pasted reference to the id alone: unwrap a URL, drop quotes, the
 * trailing slash and the leading "~". Removing the "~" is what lets an all-digit
 * Upwork reference match the id the bidding side stores.
 */
export const cleanProposalId = (raw) => {
    let value = String(raw || '').trim().replace(/^["']|["']$/g, '');
    if (value.includes('://') || /upwork\.com|fiverr\.com/i.test(value)) {
        const segments = value.split(/[?#]/)[0].split('/').filter(Boolean);
        value = segments.length ? segments[segments.length - 1] : '';
    }
    return value.replace(/\/+$/, '').replace(/^~+/, '').trim().slice(0, 100);
};

export const isUpwork = (source) => source === 'upwork';

/**
 * null when fine, otherwise a translation key suffix: 'required' blocks the save,
 * 'format' is a warning only — an unrecognised shape still saves.
 */
export const checkProposalId = (source, proposalId) => {
    if (!isUpwork(source)) return null;
    const value = cleanProposalId(proposalId);
    if (!value) return 'required';
    return UPWORK_ID.test(value) ? null : 'format';
};

/**
 * Submit-time gate for the create forms. Writes the messages onto the form model
 * (same shape the other fields use) and returns false if the save must stop.
 * `t` is the caller's i18n translate, so the strings stay translated.
 */
export const checkSourceFields = (model, t) => {
    let ok = true;
    if (!PROJECT_SOURCES.includes(model.source?.value)) {
        if (model.source) model.source.error = t('Projects.source_required');
        ok = false;
    }
    if (checkProposalId(model.source?.value, model.proposalId?.value) === 'required') {
        if (model.proposalId) model.proposalId.error = t('Projects.proposal_id_required_upwork');
        ok = false;
    }
    return ok;
};
