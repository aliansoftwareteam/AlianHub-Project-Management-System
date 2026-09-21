const crypto = require('crypto');
const { sameSecret } = require('../Auth/helpers/trackerCode');

const KEY_SALT = 'alianhub-oauth-token';
const PREFIX = Object.freeze({ code: 'ahoc_', access: 'ahoa_', refresh: 'ahor_', client: 'ahc_', secret: 'ahcs_' });
const RANDOM_PATTERN = '[A-Za-z0-9_-]{43}';
const SHAPES = Object.freeze(Object.fromEntries(Object.entries(PREFIX)
    .filter(([kind]) => kind !== 'client')
    .map(([kind, prefix]) => [kind, new RegExp(`^${prefix}${RANDOM_PATTERN}$`)])));
const CLIENT_ID = /^ahc_[a-f0-9]{24}$/;

/* Keyed with a dedicated secret when the install sets one, JWT_SECRET otherwise, and stretched so the
 * stored digest is not a plain hash of the token: a copy of the collection alone cannot test guesses. */
let cached = { material: null, key: null };
const key = () => {
    const material = process.env.MCP_OAUTH_TOKEN_SECRET || process.env.JWT_SECRET || '';
    if (!material) throw new Error('MCP_OAUTH needs MCP_OAUTH_TOKEN_SECRET or JWT_SECRET to hash tokens with');
    if (cached.material !== material) cached = { material, key: crypto.scryptSync(material, KEY_SALT, 32) };
    return cached.key;
};

const hashOf = (raw) => crypto.createHmac('sha256', key()).update(String(raw)).digest('hex');

const generate = (kind) => `${PREFIX[kind]}${crypto.randomBytes(32).toString('base64url')}`;

const newClientId = () => `${PREFIX.client}${crypto.randomBytes(12).toString('hex')}`;

const looksLike = (kind, raw) => typeof raw === 'string' && SHAPES[kind].test(raw);

module.exports = { PREFIX, CLIENT_ID, hashOf, generate, newClientId, looksLike, sameSecret };
