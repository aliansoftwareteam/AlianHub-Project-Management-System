const mongoose = require('mongoose');
const logger = require('../../Config/loggerConfig');
const { SCHEMA_TYPE } = require('../../Config/schemaType');
const { MongoDbCrudOpration } = require('../../utils/mongo-handler/mongoQueries');
const { validateSetupPayload } = require('../Setup/helpers');
const { STATE_IDS, readState, writeState } = require('./platformState');
const { activationLink } = require('./ownerLinks');

/* The languages the web app ships (frontend/src/utils/localeLoader.js plus English); a test holds the two lists together. */
const APP_LOCALES = Object.freeze(['en', 'ar', 'ch', 'fr', 'ge', 'gr', 'gu', 'hi', 'it', 'ja', 'ko', 'ptBr', 'ru', 'spa']);
const PROVISION_ID = /^[A-Za-z0-9_-]{3,100}$/;

const globalDb = (type, data, method) => MongoDbCrudOpration(SCHEMA_TYPE.GOLBAL, { type, data }, method);
const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

const isTimeZone = (zone) => {
    if (!zone || typeof zone !== 'string') return false;
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: zone }).format(0);
        return true;
    } catch {
        return false;
    }
};

/* The wizard's rules without the password, plus the fields only the platform sends. */
function validateProvision(body = {}) {
    const owner = (body && body.owner) || {};
    const workspace = (body && body.workspace) || {};
    const { data, errors } = validateSetupPayload({
        firstName: owner.firstName, lastName: owner.lastName, email: owner.email,
        companyName: workspace.name, teamFocus: workspace.teamFocus, sampleData: body.sampleData,
    }, { password: false });
    const provisionId = String(body.provisionId || '').trim();
    const locale = String(body.locale || 'en').trim();
    const timezone = String(body.timezone || 'UTC').trim();
    if (!PROVISION_ID.test(provisionId)) errors.provisionId = 'invalid';
    if (!APP_LOCALES.includes(locale)) errors.locale = 'invalid';
    if (!isTimeZone(timezone)) errors.timezone = 'invalid';
    return { valid: !Object.keys(errors).length, errors, data: { ...data, provisionId, locale, timezone } };
}

const anyUser = async () => Boolean(await globalDb(SCHEMA_TYPE.USERS, [{}, { _id: 1 }], 'findOne'));

const findByEmail = (email) => globalDb(SCHEMA_TYPE.USERS, [{ Employee_Email: email }, { _id: 1, AssignCompany: 1 }], 'findOne');

async function ownerCompany(userId) {
    const company = await globalDb(SCHEMA_TYPE.COMPANIES, [{ userId: String(userId), deletingAt: { $exists: false } }, { _id: 1 }], 'findOne');
    return company ? String(company._id) : null;
}

/* CRON_TZ is the owner's to change later; set here only when nobody has. */
async function defaultSchedulerZone(timezone) {
    const settings = require('../../Config/instanceSettings');
    if (settings.lockedKeys().includes('CRON_TZ') || settings.savedValues().CRON_TZ) return;
    await settings.saveInstanceSettings({ CRON_TZ: timezone }, 'platform');
}

/* Each step looks for what an earlier, interrupted run made before making it, so a retry with the
 * same provisionId finishes the job; a different provisionId once one has started is refused. */
async function provision(data, { emit = () => {} } = {}) {
    const step = (name) => {
        logger.info(`[platform] provision ${data.provisionId}: ${name}`);
        emit(name);
    };
    const state = await readState(STATE_IDS.PROVISION);
    if (state && state.provisionId && state.provisionId !== data.provisionId) throw conflict('This instance was provisioned with another provisionId.');
    if (!state && (await anyUser())) throw conflict('This instance is already set up.');
    if (!state) await writeState(STATE_IDS.PROVISION, { provisionId: data.provisionId, startedAt: new Date() });

    if (!(state && state.completedAt)) {
        let userId = state && state.userId;
        if (!userId) {
            step('seeds');
            await require('../Setup/initalizations').startInitialization();
            step('account');
            const existing = await findByEmail(data.email);
            const profile = { activationPending: true, languageCode: data.locale, Time_Zone: data.timezone };
            const { createOwner } = require('../Setup/createCompany');
            userId = existing ? String(existing._id) : await createOwner({ ...data, password: null }, profile);
            if (existing) await globalDb(SCHEMA_TYPE.USERS, [{ _id: new mongoose.Types.ObjectId(userId) }, { $set: { ...profile, isProductOwner: true, isEmailVerified: true } }], 'updateOne');
            await writeState(STATE_IDS.PROVISION, { userId });
        }
        let companyId = state && state.companyId;
        if (!companyId) {
            companyId = await ownerCompany(userId);
            if (!companyId) {
                const { createFirstCompany } = require('../Setup/createCompany');
                companyId = await createFirstCompany({ ...data, userId, onStep: step });
            }
            await writeState(STATE_IDS.PROVISION, { companyId });
        }
        await defaultSchedulerZone(data.timezone).catch((error) => logger.error(`[platform] provision: CRON_TZ not saved: ${error.message}`));
        await writeState(STATE_IDS.PROVISION, { completedAt: new Date() });
        step('STOP');
    }
    const done = await readState(STATE_IDS.PROVISION);
    const link = await activationLink();
    return { userId: String(done.userId), companyId: String(done.companyId), activationUrl: link.activationUrl, activationExpiresAt: link.activationExpiresAt };
}

module.exports = { APP_LOCALES, validateProvision, provision, isTimeZone };
