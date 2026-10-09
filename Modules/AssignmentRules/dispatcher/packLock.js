const mongoose = require('mongoose');
const logger = require('../../../Config/loggerConfig');
const workMarks = require('../../Agents/workMarks');
const { RuleError } = require('../rules');

const SCOPE = 'team-pack';
const KEY = 'apply';
const LEASE_MS = 2 * 60 * 1000;
const BUSY = 'Another team pack is being applied or undone in this workspace. Try again in a moment.';

/* One pack change at a time per company, so two applies cannot both find no agent for a role and each make one.
 * The lease runs out by itself if a server stops while it holds it. */
async function withPackLock(companyId, work) {
    const token = new mongoose.Types.ObjectId().toString();
    const now = Date.now();
    const was = await workMarks.markAt(companyId, SCOPE, KEY);
    if (was && was.by && was.until && new Date(was.until).getTime() > now) throw new RuleError(BUSY, 409);
    const held = await workMarks.take(companyId, SCOPE, KEY, was, { by: token, at: new Date(now), until: new Date(now + LEASE_MS) });
    if (!held) throw new RuleError(BUSY, 409);
    try {
        return await work();
    } finally {
        await workMarks.giveUp(companyId, { scope: SCOPE, key: KEY, by: token })
            .catch((error) => logger.error(`[team-pack] could not release the pack lock: ${error.message}`));
    }
}

module.exports = { withPackLock, BUSY, LEASE_MS };
