const { isStrict } = require('./apiTokenRules');
const { firstSeenMark } = require('./firstSeen');

/* When the maximum lifetime first applied on this instance: a token made earlier with a
 * longer expiry keeps working for the maximum lifetime counted from here. */
const mark = firstSeenMark('apiTokenMaxLifetimeSince', 'api token maximum lifetime');

const noteMaxLifetime = () => (isStrict() ? mark.read() : Promise.resolve(null));

module.exports = { FIELD: mark.FIELD, maxLifetimeSince: mark.read, noteMaxLifetime, forget: mark.forget };
