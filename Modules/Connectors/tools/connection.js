const fs = require('fs');
const path = require('path');

const CODE = Object.freeze({
    NOT_CONNECTED: 'not_connected',
    NOT_MEMBER: 'not_member',
    BROKEN: 'broken',
    SCOPE_MISSING: 'scope_missing',
    PROVIDER_OFF: 'provider_off',
});

const OFF = ['', 'off', 'false', '0', 'no', 'none'];

/* The shape the contract gives ConnectorError (name, code, provider), so a caller tells it apart the same way
 * whichever side threw it. */
const refusal = (code, provider, message = `${code}: ${provider}`) => Object.assign(new Error(message), { name: 'ConnectorError', code, provider: String(provider) });
const isConnectorError = (error) => Boolean(error) && error.name === 'ConnectorError' && Object.values(CODE).includes(error.code);

/* Track A's resolveConnection.js (task 063, then 066) is the only place a connection is read. Until it is on this
 * branch the contract's stub stands in: nothing is connected, so every call is refused before a provider is reached. */
const RESOLVER = path.join(__dirname, '..', 'resolveConnection.js');

const named = () => {
    const raw = String(process.env.CONNECTORS || '').trim().toLowerCase();
    return OFF.includes(raw) ? [] : [...new Set(raw.split(/[\s,]+/).filter(Boolean))];
};

const isNamed = (provider) => named().includes(String(provider));

const resolve = async ({ companyId, userId, provider }) => {
    if (fs.existsSync(RESOLVER)) return require(RESOLVER).resolveConnection({ companyId, userId, provider });
    throw refusal(isNamed(provider) ? CODE.NOT_CONNECTED : CODE.PROVIDER_OFF, provider);
};

module.exports = { CODE, named, isNamed, resolve, refusal, isConnectorError };
