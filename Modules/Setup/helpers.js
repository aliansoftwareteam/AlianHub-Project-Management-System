const buildInfo = require('../../Config/buildInfo');
const { TEAM_FOCUS_OPTIONS } = require('../../utils/sampleTasks');
const { meetsPasswordRule } = require('../Auth/helpers/passwordRule');

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* Pure: what the wizard learns from the two facts the server can check. */
function computeSetupStatus({ db, userCount, appVersion = buildInfo.get().version }) {
    return {
        installed: Boolean(db?.ok) && Number(userCount) > 0,
        dbOk: Boolean(db?.ok),
        dbError: db?.ok ? null : (db?.error || 'Database is not reachable'),
        version: appVersion,
    };
}

/* Pure: normalises the completion payload and names every problem at once. The platform's headless
 * setup (Modules/Platform/provision.js) creates the owner without a password: `password: false`. */
function validateSetupPayload(body = {}, { password: needsPassword = true } = {}) {
    const errors = {};
    const value = (key) => String(body[key] ?? '').trim();
    const data = {
        firstName: value('firstName'),
        lastName: value('lastName'),
        email: value('email').toLowerCase(),
        password: needsPassword ? String(body.password ?? '') : null,
        companyName: value('companyName'),
        teamFocus: value('teamFocus'),
        sampleData: body.sampleData === undefined ? true : body.sampleData === true || body.sampleData === 'true',
        eventId: value('eventId'),
    };
    if (!data.firstName) errors.firstName = 'required';
    if (!data.lastName) errors.lastName = 'required';
    if (!EMAIL_RX.test(data.email)) errors.email = 'invalid';
    if (needsPassword && !meetsPasswordRule(data.password)) errors.password = 'weak';
    if (!data.companyName) errors.companyName = 'required';
    if (data.teamFocus && !TEAM_FOCUS_OPTIONS.includes(data.teamFocus)) errors.teamFocus = 'invalid';
    return { data, errors, valid: Object.keys(errors).length === 0 };
}

module.exports = { computeSetupStatus, validateSetupPayload };
