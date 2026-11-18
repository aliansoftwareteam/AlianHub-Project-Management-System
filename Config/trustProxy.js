/* Express reads any string as an address list, so "true" would stop the server at startup
 * and a hop count such as "1" would name the address 0.0.0.1. */
const trustProxySetting = (raw) => {
    const value = String(raw ?? '').trim();
    if (!value) return 'loopback';
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
    if (/^\d+$/.test(value)) return Number(value);
    return value;
};

module.exports = { trustProxySetting };
