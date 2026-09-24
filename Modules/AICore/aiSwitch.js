const mongoose = require('mongoose');
const { dbCollections } = require('../../Config/collections');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { removeCache } = require('../../utils/commonFunctions');
const logger = require('../../Config/loggerConfig');

/* "AI off", at two levels. The instance owner sets AI_ENABLED=false (Instance › Settings or the
 * environment); a workspace owner or admin sets the company row's `aiSwitch.enabled` to false.
 * Either one stops every model call before it leaves the server: the spend meter asks here
 * before any adapter runs, and speech-to-text asks before it uploads. */

const AI_OFF = 'ai_off';
const COMPANY_FIELD = 'aiSwitch';
const OBJECT_ID = /^[a-f0-9]{24}$/i;
const CACHE_TTL_MS = 15 * 1000;
const FAILED_READ_TTL_MS = 5 * 1000;

const STATE = Object.freeze({
    ON: 'on',
    OFF_INSTANCE: 'off_instance',
    OFF_WORKSPACE: 'off_workspace',
    UNCONFIGURED: 'unconfigured',
});

const cache = new Map();

const instanceEnabled = () => String(process.env.AI_ENABLED || '').trim().toLowerCase() !== 'false';

const remember = (companyId, enabled, ttlMs = CACHE_TTL_MS) => {
    cache.set(companyId, { enabled, until: Date.now() + ttlMs });
    return enabled;
};

const cached = (companyId) => {
    const hit = cache.get(String(companyId || ''));
    return hit && hit.until > Date.now() ? hit : null;
};

/* Only an explicit false turns a workspace off; an absent or unreadable field is on. A row that
 * cannot be read is treated as off for a few seconds, since "no call leaves while off" must hold
 * even when the database is slow to say so. */
async function workspaceEnabled(companyId) {
    const id = String(companyId || '');
    if (!OBJECT_ID.test(id)) return true;
    const hit = cached(id);
    if (hit) return hit.enabled;
    try {
        const company = await MongoDbCrudOpration(dbCollections.GLOBAL, {
            type: dbCollections.COMPANIES,
            data: [{ _id: new mongoose.Types.ObjectId(id) }, COMPANY_FIELD],
        }, 'findOne');
        const stored = company && company[COMPANY_FIELD];
        return remember(id, !(stored && stored.enabled === false));
    } catch (error) {
        logger.error(`ai switch: company ${id} unreadable, AI held off for ${FAILED_READ_TTL_MS / 1000}s: ${error.message}`);
        return remember(id, false, FAILED_READ_TTL_MS);
    }
}

/* The synchronous read for code that cannot wait: what the last read said, on when unknown. The
 * spend meter still asks workspaceEnabled() before every call, so an unknown never lets one through. */
const workspaceOffCached = (companyId) => {
    const hit = cached(companyId);
    return Boolean(hit && hit.enabled === false);
};

async function setWorkspaceEnabled(companyId, enabled, actor = '') {
    const id = String(companyId || '');
    if (!OBJECT_ID.test(id)) throw new Error('A workspace id is required.');
    const value = { enabled: Boolean(enabled), updatedAt: new Date(), updatedBy: String(actor || '') };
    const written = await MongoDbCrudOpration(dbCollections.GLOBAL, {
        type: dbCollections.COMPANIES,
        data: [{ _id: new mongoose.Types.ObjectId(id) }, { $set: { [COMPANY_FIELD]: value } }],
    }, 'updateOne');
    if (!written || written.matchedCount < 1) throw Object.assign(new Error('No such workspace.'), { statusCode: 404 });
    removeCache(`companyData_${id}`);
    remember(id, value.enabled);
    return value;
}

const offError = (scope) => Object.assign(
    new Error(scope === 'instance' ? 'AI is turned off for this instance.' : 'AI is turned off for this workspace.'),
    { code: AI_OFF, scope, retryable: false, statusCode: 403 },
);

async function assertAllowed(companyId) {
    if (!instanceEnabled()) throw offError('instance');
    if (!(await workspaceEnabled(companyId))) throw offError('workspace');
}

async function allowed(companyId) {
    return instanceEnabled() && workspaceEnabled(companyId);
}

const isAiOff = (error) => Boolean(error) && error.code === AI_OFF;

const forget = (companyId) => {
    if (companyId === undefined) cache.clear();
    else cache.delete(String(companyId));
};

module.exports = { AI_OFF, COMPANY_FIELD, STATE, instanceEnabled, workspaceEnabled, workspaceOffCached, setWorkspaceEnabled, assertAllowed, allowed, isAiOff, forget };
