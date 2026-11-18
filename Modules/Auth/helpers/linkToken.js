const crypto = require('crypto');

const newLinkToken = () => crypto.randomBytes(32).toString('hex');

module.exports = { newLinkToken };
