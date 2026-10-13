const dns = require('dns');

const DNS_TIMEOUT_MS = 10000;
const DNS_TIMEOUT = 'EDNSTIMEOUT';

const resolveTxt = (name) => Promise.race([
    dns.promises.resolveTxt(name),
    new Promise((resolve, reject) => {
        setTimeout(() => reject(Object.assign(new Error('DNS lookup timed out'), { code: DNS_TIMEOUT })), DNS_TIMEOUT_MS).unref();
    }),
]);

/* Only these answers say the record is not there; anything else says the resolver could not tell. */
const RECORD_ABSENT = new Set(['ENOTFOUND', 'ENODATA']);
const saysRecordAbsent = (error) => Boolean(error && RECORD_ABSENT.has(error.code));

module.exports = { resolveTxt, saysRecordAbsent };
