const { personDecides, SESSION_SETS } = require('../../Agents/personDecides');

/* Two-step sign-in, the password and the sessions are what stand between a leaked token and the
 * whole account, so they change only from a session the person signed in to themselves. */
const signedInPersonOnly = (req, res) => personDecides(req, res, 'account.security', SESSION_SETS);

module.exports = { signedInPersonOnly };
