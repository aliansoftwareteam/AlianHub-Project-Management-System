const { personDecides, SESSION_SETS } = require('../../Agents/personDecides');

/* Two-step sign-in, the password and the sessions are what stand between a leaked token and the
 * whole account, so they change only from a session the person signed in to themselves. */
const signedInPersonOnly = (req, res) => personDecides(req, res, 'account.security', SESSION_SETS);

const SESSION_READS = 'Only a person signed in to AlianHub can see this; an API token cannot.';

/* How the account is protected and where it is signed in tell a token's holder what to go after next. */
const signedInPersonReads = (req, res) => personDecides(req, res, 'account.security', SESSION_READS);

module.exports = { signedInPersonOnly, signedInPersonReads };
