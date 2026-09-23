/* req.ip honours x-forwarded-for only as far as the trust proxy setting allows, so a client cannot choose
 * the address that is stored, shown or rate-limited against. */
const requestAddress = (req) => String((req && (req.ip || (req.socket && req.socket.remoteAddress))) || '');

module.exports = { requestAddress };
