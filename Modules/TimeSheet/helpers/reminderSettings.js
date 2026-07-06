/**
 * Time-entry reminder — per-company settings.
 *
 * Stores an opt-in policy on the GLOBAL `companies` master doc under the
 * `timeReminderSettings` field so the daily cron can enumerate opted-in
 * companies without opening every tenant DB. Mirrors the storage approach
 * used by Modules/ScreenshotRetention/helper.js.
 *
 * Shape:
 *   {
 *     enabled: boolean,     // default false — the daily "log your time" mail
 *                           //   is OFF for a company until an owner turns it on
 *     userIds: string[],    // when enabled, ONLY these members are eligible
 *                           //   recipients (empty ⇒ nobody)
 *     enabledAt: Date|null,
 *     enabledBy: string|null
 *   }
 */

const mongoose = require('mongoose');
const { MongoDbCrudOpration } = require('../../../utils/mongo-handler/mongoQueries');
const { SCHEMA_TYPE } = require('../../../Config/schemaType');

// Mongoose Map → plain object (missing ⇒ null so we fall through to defaults).
function mapToObject(value) {
    if (!value) return null;
    if (value instanceof Map) return Object.fromEntries(value);
    return value;
}

// Always return a fully-shaped object, even for legacy companies with no field.
function normaliseSettings(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const ids = Array.isArray(s.userIds) ? s.userIds : [];
    return {
        enabled: s.enabled === true,
        userIds: [...new Set(ids.map((id) => String(id)).filter(Boolean))],
        enabledAt: s.enabledAt || null,
        enabledBy: s.enabledBy || null,
    };
}

async function getCompanySettings(companyId) {
    const query = {
        type: SCHEMA_TYPE.COMPANIES,
        data: [
            { _id: new mongoose.Types.ObjectId(companyId) },
            { _id: 1, timeReminderSettings: 1 },
        ],
    };
    const company = await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, query, 'findOne');
    return normaliseSettings(mapToObject(company && company.timeReminderSettings));
}

/**
 * Update the policy. `patch` may carry `enabled` and/or `userIds`. When the
 * policy flips disabled → enabled we stamp enabledAt / enabledBy for audit.
 */
async function updateCompanySettings(companyId, patch, opts = {}) {
    const setObj = {};
    if (typeof patch.enabled === 'boolean') {
        setObj['timeReminderSettings.enabled'] = patch.enabled;
    }
    if (patch.userIds !== undefined) {
        const ids = Array.isArray(patch.userIds) ? patch.userIds : [];
        setObj['timeReminderSettings.userIds'] = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
    }
    if (opts.markEnabled && opts.userId) {
        setObj['timeReminderSettings.enabledAt'] = new Date();
        setObj['timeReminderSettings.enabledBy'] = String(opts.userId);
    }
    if (Object.keys(setObj).length === 0) return getCompanySettings(companyId);

    const query = {
        type: SCHEMA_TYPE.COMPANIES,
        data: [
            { _id: new mongoose.Types.ObjectId(companyId) },
            { $set: setObj },
            { new: true, useFindAndModify: false },
        ],
    };
    await MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, query, 'findOneAndUpdate');
    return getCompanySettings(companyId);
}

module.exports = { getCompanySettings, updateCompanySettings, normaliseSettings };
