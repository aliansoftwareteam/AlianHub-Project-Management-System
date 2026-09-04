const { version } = require('../../package.json');
const { TEAM_FOCUS_OPTIONS } = require('../../utils/sampleTasks');

const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;

/* Pure: what the wizard learns from the two facts the server can check. */
function computeSetupStatus({ db, userCount, appVersion = version }) {
    return {
        installed: Boolean(db?.ok) && Number(userCount) > 0,
        dbOk: Boolean(db?.ok),
        dbError: db?.ok ? null : (db?.error || 'Database is not reachable'),
        version: appVersion,
    };
}

/* Pure: normalises the completion payload and names every problem at once. */
function validateSetupPayload(body = {}) {
    const errors = {};
    const value = (key) => String(body[key] ?? '').trim();
    const data = {
        firstName: value('firstName'),
        lastName: value('lastName'),
        email: value('email').toLowerCase(),
        password: String(body.password ?? ''),
        companyName: value('companyName'),
        teamFocus: value('teamFocus'),
        sampleData: body.sampleData === undefined ? true : body.sampleData === true || body.sampleData === 'true',
        eventId: value('eventId'),
    };
    if (!data.firstName) errors.firstName = 'required';
    if (!data.lastName) errors.lastName = 'required';
    if (!EMAIL_RX.test(data.email)) errors.email = 'invalid';
    if (data.password.length < MIN_PASSWORD) errors.password = `min_${MIN_PASSWORD}`;
    if (!data.companyName) errors.companyName = 'required';
    if (data.teamFocus && !TEAM_FOCUS_OPTIONS.includes(data.teamFocus)) errors.teamFocus = 'invalid';
    return { data, errors, valid: Object.keys(errors).length === 0 };
}

module.exports = { computeSetupStatus, validateSetupPayload, MIN_PASSWORD };
