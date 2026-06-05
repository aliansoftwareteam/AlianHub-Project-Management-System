/**
 * Proposal Review module init — registers the event listener at app startup.
 *
 * Called from index.js after the standard module inits. Does nothing if the
 * feature isn't fully configured (missing API key, agent id, env id, PG url,
 * or actor user id) — the rest of the app keeps working as before.
 */
'use strict';

const logger = require('../../Config/loggerConfig');
const trigger = require('./trigger');

exports.init = (_app) => {
    if (!trigger.isConfigured()) {
        logger.warn('[ProposalReview] not fully configured — listener NOT registered. '
            + 'Set ANTHROPIC_API_KEY, PROPOSAL_REVIEW_AGENT_ID, PROPOSAL_REVIEW_ENV_ID, '
            + 'and PROPOSAL_PG_URL to enable. (Actor is the static AlianHub AI Bot — no user-id env var needed.)');
        return;
    }
    const ok = trigger.register();
    if (ok) {
        logger.info('[ProposalReview] event listener registered — will auto-review tasks moved into "In Review - TL" on projects with the proposalReview app enabled.');
    }
};
